// One script for the whole site. Every page loads it, and each init below
// returns early when its page has none of what it needs — that is why none of
// them are gated on the page's identity. Navigation is a real page load (see
// the page-transitions section of style.css), so this runs once per page and
// there is nothing to tear down.

// ─── FADE IN ──────────────────────────────────────────────────────────────────

// body starts at opacity 0 in the stylesheet so the page never paints before
// its fonts and CSS are in; this hands it back on the first frame.
requestAnimationFrame(() => { document.body.style.opacity = '1'; });

// ─── CORNER NAV ───────────────────────────────────────────────────────────────

// Each of the four labels takes its colour from whatever is actually behind it:
// white over dark media, the page's ink over light media and over the page
// itself. Tracking the hero's edge instead only worked while the hero was the
// one thing a label could land on; against a mosaic of mixed artwork the same
// label needs to be white over one thumbnail and ink over its neighbour.

const TONE_GRID = 12;                    // luminance cells per axis
const TONE_DARK = 128;                   // below this, the label goes white
const TONE_VIDEO_TTL = 500;              // ms before a playing frame is re-read

const toneCache = new WeakMap();

// Luminance of the page ground, read once from the stylesheet so it follows
// --bg-color rather than repeating the hex here.
const BG_LUMINANCE = (() => {
    const m = getComputedStyle(document.documentElement).backgroundColor.match(/[0-9]+/g);
    return m ? 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] : 242;
})();

// Draws the asset once into a tiny canvas and keeps a grid of luminances.
// Downscaling is what makes this cheap: the browser averages the pixels for us,
// so a scroll only ever reads 144 values instead of the full-resolution image.
function toneGrid(el) {
    const isVideo = el.tagName === 'VIDEO';
    const cached = toneCache.get(el);
    // An image's tone never changes; a playing video's does.
    if (cached && !(isVideo && performance.now() - cached.at > TONE_VIDEO_TTL)) return cached;

    const w = isVideo ? el.videoWidth : el.naturalWidth;
    const h = isVideo ? el.videoHeight : el.naturalHeight;
    if (!w || !h) return cached || null;  // no dimensions yet

    // Dimensions arrive with the file header, whole pixels do not. Drawing in
    // between yields a blank canvas that reads as pure black — and an image's
    // grid is cached for good, so that one bad reading would pin every label
    // over it to white for the life of the page. Wait for the real thing:
    // complete only turns true once an image has finished decoding, and
    // readyState 2 is a video's first usable frame. The load and loadeddata
    // listeners in initCornerNav bring us straight back here when it does.
    if (!(isVideo ? el.readyState >= 2 : el.complete)) return cached || null;

    const canvas = toneGrid.canvas || (toneGrid.canvas = document.createElement('canvas'));
    canvas.width = canvas.height = TONE_GRID;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let cells;
    try {
        ctx.drawImage(el, 0, 0, TONE_GRID, TONE_GRID);
        const px = ctx.getImageData(0, 0, TONE_GRID, TONE_GRID).data;
        cells = new Float32Array(TONE_GRID * TONE_GRID);
        for (let i = 0; i < cells.length; i++) {
            const p = i * 4;
            cells[i] = 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
        }
    } catch {
        // Cross-origin media taints the canvas and getImageData throws. Nothing
        // here is remote today, but moving assets to a CDN should fall back to
        // the page's ink rather than break the nav.
        return null;
    }

    // Connect lays a wash of the page's ground over its blurred background, so
    // the pixels on screen are not the pixels in the file. --veil says how much.
    const veil = parseFloat(getComputedStyle(el.parentElement).getPropertyValue('--veil')) || 0;

    const entry = { cells, w, h, veil, at: performance.now() };
    toneCache.set(el, entry);
    return entry;
}

// object-fit: cover crops the source, so a viewport point is not where the same
// point falls in the file. This undoes the scale and whatever object-position
// the element carries — the Info hero is offset to its waterline, for one.
function objectOffset(el) {
    const parts = getComputedStyle(el).objectPosition.split(' ');
    const axis = v => {
        if (v.endsWith('%')) return parseFloat(v) / 100;
        if (v === 'left' || v === 'top') return 0;
        if (v === 'right' || v === 'bottom') return 1;
        return 0.5;
    };
    return [axis(parts[0]), axis(parts[1] === undefined ? parts[0] : parts[1])];
}

function luminanceAt(el, rect, x, y) {
    const grid = toneGrid(el);
    if (!grid) return null;

    const scale = Math.max(rect.width / grid.w, rect.height / grid.h);
    const drawnW = grid.w * scale;
    const drawnH = grid.h * scale;
    const [posX, posY] = objectOffset(el);

    const u = (x - rect.left - (rect.width - drawnW) * posX) / drawnW;
    const v = (y - rect.top - (rect.height - drawnH) * posY) / drawnH;

    const clamp = n => Math.min(TONE_GRID - 1, Math.max(0, Math.floor(n * TONE_GRID)));
    const raw = grid.cells[clamp(v) * TONE_GRID + clamp(u)];
    return raw * (1 - grid.veil) + BG_LUMINANCE * grid.veil;
}

function initCornerNav() {
    const nav = document.querySelector('.corner-nav');
    if (!nav) return;

    const labels = Array.from(nav.children);
    // Everything a label can end up in front of. .case-block belongs here as
    // much as .thumb does: a case study's media is what the corners sit over
    // for most of that page, and a label left out of this list keeps whatever
    // colour it had over the hero.
    const assets = Array.from(document.querySelectorAll(
        '.hero img, .hero video, .thumb img, .thumb video, ' +
        '.case-block img, .case-block video, .research-item img, .research-item video'
    ));

    let queued = false;
    let videoTimer = null;
    let settled = false;

    function update() {
        queued = false;
        clearTimeout(videoTimer);

        // The intro moves the labels through the middle of the screen and sets
        // their colour itself; readings taken mid-flight would fight it. It
        // announces a backdropchange when it hands the labels back.
        if (document.documentElement.classList.contains('is-intro')) return;

        // Read every rect once. Testing three points per label against ten
        // assets would otherwise force a hundred-odd layout reads per frame.
        //
        // The opacity test skips a frame that has faded out: Info's pair shares
        // one box, and an invisible frame must not be what a label reads.
        const boxes = assets
            .map(el => ({ el, rect: el.getBoundingClientRect() }))
            .filter(({ el, rect }) => rect.bottom > 0 && rect.top < innerHeight
                && parseFloat(getComputedStyle(el).opacity) >= 0.5);

        let overVideo = false;
        let anyRead = false;

        labels.forEach(label => {
            const r = label.getBoundingClientRect();
            const y = r.top + r.height / 2;
            // Sample across the label, not just its centre: a wide word like
            // Research can straddle two very different regions.
            const xs = [r.left + 2, r.left + r.width / 2, r.right - 2];

            let total = 0;
            let n = 0;

            xs.forEach(x => {
                // findLast, not find: later siblings paint on top, and Info's
                // pair deliberately keeps a fully opaque frame underneath the
                // one being faded in. The topmost match is what is on screen.
                const hit = boxes.findLast(({ rect }) =>
                    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
                if (!hit) return;                       // page background: light
                const lum = luminanceAt(hit.el, hit.rect, x, y);
                if (lum === null) return;
                if (hit.el.tagName === 'VIDEO') overVideo = true;
                total += lum;
                n++;
            });

            if (n) anyRead = true;
            // With nothing under it a label is over the page's own ground, so
            // that ground decides. This used to assume ink, which was right
            // while every page was pale and wrong the moment one was not: on
            // the black archive a label between pieces turned near-black.
            label.classList.toggle('is-on-dark',
                n > 0 ? total / n < TONE_DARK : BG_LUMINANCE < TONE_DARK);
        });

        // Nothing fires a scroll event while a video plays under a stationary
        // label, so poll just that case, and only while it is true.
        if (overVideo) videoTimer = setTimeout(update, TONE_VIDEO_TTL);

        // The first reading corrects whatever the labels were painted as before
        // the media decoded. Let that one land instantly; animate the rest.
        if (anyRead && !settled) {
            settled = true;
            requestAnimationFrame(() => nav.classList.remove('is-tone-pending'));
        }
    }

    function onScroll() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(update);
    }

    nav.classList.add('is-tone-pending');
    // capture, because a scroll event raised by an element does not bubble to
    // the window. The archive's columns each scroll on their own, and without
    // this the labels would hold whatever colour they had when the page loaded
    // while the pictures moved underneath them.
    addEventListener('scroll', onScroll, { passive: true, capture: true });
    addEventListener('resize', onScroll);
    // Nothing else tells the labels the backdrop changed under them while the
    // page sat still — see initHeroPair.
    addEventListener('backdropchange', onScroll);
    // Media decodes after this runs, so re-read as each asset arrives.
    assets.forEach(el => {
        el.addEventListener('load', onScroll);
        el.addEventListener('loadeddata', onScroll);
    });
    update();
}

// ─── ALTERNATING HERO ─────────────────────────────────────────────────────────

// Info's hero holds two frames in one box and trades between them. The fade
// itself is CSS; this only moves the class and keeps the clock.

const HERO_PAIR_HOLD = 6000;             // ms each frame stays up

function initHeroPair() {
    const pair = document.querySelector('.hero--pair');
    if (!pair) return;

    const frames = Array.from(pair.querySelectorAll('img'));
    if (frames.length < 2) return;

    // The lower frame is the bed and never moves; only the upper one is toggled.
    const overlay = frames[frames.length - 1];

    // A cross-fade on a timer is exactly the motion this asks to suppress, so
    // the bed frame simply stays up.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // The corner labels take their colour from what is behind them, and a swap
    // changes that with no scroll to notice it. Announced at the end of the fade,
    // since until then the outgoing frame is still the one mostly on screen.
    overlay.addEventListener('transitionend', e => {
        if (e.propertyName === 'opacity') dispatchEvent(new Event('backdropchange'));
    });

    setInterval(() => overlay.classList.toggle('is-shown'), HERO_PAIR_HOLD);
}

// ─── VIDEO PLAYBACK ───────────────────────────────────────────────────────────

// Covers both the hero and the grid frames. The markup already autoplays:
// muted + playsinline + loop is what every browser requires before it will
// start a video without a gesture. This adds the two things attributes cannot
// do.
//
// 1. Only play what is on screen. A hero plus a grid of autoplaying videos
//    would decode all of them at once, including the hero long after it has
//    scrolled away; off-screen ones are paused and rewound.
// 2. Retry the play() the observer triggers. Even a correctly muted video is
//    refused in iOS Low Power Mode and under some data-saver settings, and the
//    returned promise rejects — unhandled, that logs an error on every scroll.
//
// Anyone who has asked for reduced motion gets a still frame instead.

function initVideos() {
    // Every autoplaying frame on the site, not just the home page's. The case
    // studies and the archive were missing from this list and so kept decoding
    // off-screen — on the archive that is five films at once, several of them
    // never in view.
    const videos = document.querySelectorAll(
        '.hero video, .thumb video, .case-block video, .research-item video'
    );
    if (!videos.length) return;

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        videos.forEach(v => { v.autoplay = false; v.pause(); });
        return;
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(({ target, isIntersecting }) => {
            if (isIntersecting) {
                target.play().catch(() => {});
            } else {
                target.pause();
                target.currentTime = 0;
            }
        });
    // A little margin so a frame is already running by the time it scrolls in.
    }, { rootMargin: '200px 0px' });

    videos.forEach(v => observer.observe(v));
}

// ─── COPY EMAIL ───────────────────────────────────────────────────────────────

// Both labels are already in the markup, stacked in one grid cell, so this only
// has to toggle a class — the element's width never changes and the links
// beside it in the row stay put.

document.addEventListener('click', e => {
    const el = e.target.closest('.copy-email');
    if (!el || el.dataset.copying) return;
    el.dataset.copying = '1';

    const release = () => { delete el.dataset.copying; };

    navigator.clipboard.writeText(el.dataset.email).then(() => {
        el.classList.add('is-copied');
        setTimeout(() => {
            el.classList.remove('is-copied');
            release();
        }, 1200);
    // Without this the flag would stay set on a rejected write — a denied
    // clipboard permission would leave the control dead for the session.
    }).catch(release);
});

// ─── MEDIA VIEWER ─────────────────────────────────────────────────────────────

// A case study's frames crop to the grid; this is where the uncropped file is
// seen. Every item stacks at full viewport width and you scroll vertically
// through them — deliberately not a horizontal pager that scales each image
// down to *fit* the viewport rather than fill it.

let viewerEl = null;

function closeViewer() {
    if (!viewerEl) return;
    viewerEl.classList.remove('is-open');
    viewerEl.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('viewer-open');
    // Stop any video that was playing inside the viewer.
    viewerEl.querySelectorAll('video').forEach(v => v.pause());
    // The drawn cursor is a plus outside and a minus in: it has to be told,
    // because opening and closing need not involve moving the pointer at all.
    dispatchEvent(new Event('viewertoggle'));
}

function openViewer(index) {
    if (!viewerEl) return;
    viewerEl.classList.add('is-open');
    viewerEl.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('viewer-open');

    // Jump straight to the clicked item instead of scrolling past the others.
    const slide = viewerEl.querySelectorAll('.viewer-slide')[index];
    viewerEl.scrollTop = slide ? slide.offsetTop : 0;

    const video = slide && slide.querySelector('video');
    if (video) video.play().catch(() => {});

    dispatchEvent(new Event('viewertoggle'));
}

function initViewer() {
    const items = Array.from(document.querySelectorAll('.viewer-item'));
    if (!items.length) return;

    viewerEl = document.createElement('div');
    viewerEl.className = 'viewer';
    viewerEl.setAttribute('aria-hidden', 'true');

    const track = document.createElement('div');
    track.className = 'viewer-track';

    items.forEach(item => {
        const slide = document.createElement('div');
        slide.className = 'viewer-slide';

        const sourceVideo = item.querySelector('video');
        if (sourceVideo) {
            // Clone keeps the <source> children and the autoplay/loop/muted attrs.
            slide.appendChild(sourceVideo.cloneNode(true));
        } else {
            const img = document.createElement('img');
            img.src = item.getAttribute('href');
            img.alt = '';
            slide.appendChild(img);
        }

        track.appendChild(slide);
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'viewer-close';
    close.textContent = 'Close';
    close.addEventListener('click', closeViewer);

    // Click anywhere to dismiss. The close button's own handler also fires via
    // bubbling, which is harmless — closing twice is a no-op.
    viewerEl.addEventListener('click', closeViewer);

    viewerEl.appendChild(track);
    viewerEl.appendChild(close);
    document.body.appendChild(viewerEl);

    items.forEach((item, index) => {
        item.addEventListener('click', e => {
            e.preventDefault();
            openViewer(index);
        });
    });
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeViewer();
});

// ─── INTRO ────────────────────────────────────────────────────────────────────

// A greeting for anyone arriving at the home page from outside the site. The
// four labels come in at the centre as a small block, a window onto the hero
// with softly rounded corners opens behind them, and the window grows to fill
// the screen with each label pinned to its own corner of it — the navigation
// is carried out to the edges by the frame it belongs to.
//
// It plays once per browser session, never on arrival from another page of
// the site (the view transition covers that), never for a deep link, and never
// for anyone who has asked for reduced motion. It waits until the page is
// actually on screen. Any click, key, wheel or touch skips straight to the end.
// Add ?intro to the address to see it again.

const INTRO_KEY = 'intro-seen';

// The whole greeting is one timeline, in ms from the first frame. The phases
// overlap on purpose: each begins while the one before is still settling, so
// the motion hands off instead of coming to rest and restarting. An earlier cut
// ran them in sequence, and every handover read as a stall.
//
// These numbers were set by measuring what was actually on screen. The first
// cut ran 2850ms and held the window within 7% of its opening size for the
// first 1500 of them — more than half the greeting spent on a composition that
// barely moved, then the entire expansion crammed into the last 900ms. Waiting
// is not poise. The front is tightened, the expansion is given the room the
// waiting used to take, and the whole thing lands half a second sooner.
const INTRO_PHASES = {
    fade:   [0, 700],       // the four labels soft-focus in
    open:   [350, 1000],    // the window blooms in behind them
    expand: [700, 2200],    // the window fills the frame, labels on its corners
};
const INTRO_END = 2200;

// A CSS cubic-bezier, solved in script so the greeting can move on the same
// kind of curve the stylesheet uses rather than on whichever polynomial happens
// to be close. x is time, the answer is distance; the solve is for the curve's
// own parameter in between, which Newton-Raphson finds in a handful of passes
// on curves this well behaved.
function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const atX = t => ((ax * t + bx) * t + cx) * t;
    const atY = t => ((ay * t + by) * t + cy) * t;
    const slope = t => (3 * ax * t + 2 * bx) * t + cx;

    return x => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 6; i++) {
            const d = slope(t);
            // A flat stretch would send the step to infinity; the estimate in
            // hand is already close enough when that happens.
            if (Math.abs(d) < 1e-6) break;
            const err = atX(t) - x;
            if (Math.abs(err) < 1e-6) break;
            t -= err / d;
        }
        return atY(t);
    };
}

function shouldPlayIntro() {
    if (!document.querySelector('[data-intro]')) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (new URLSearchParams(location.search).has('intro')) return true;
    if (location.hash) return false;
    try {
        if (sessionStorage.getItem(INTRO_KEY)) return false;
        if (document.referrer && new URL(document.referrer).origin === location.origin) return false;
    } catch {
        // Storage blocked or an unparseable referrer: greet rather than guess.
    }
    return true;
}

// Resolves once the hero has a frame to show, so the window opens onto the
// picture and not onto the pale placeholder behind it.
function introMediaReady(el) {
    if (!el) return Promise.resolve();
    const ready = el.tagName === 'VIDEO' ? el.readyState >= 2 : el.complete;
    if (ready) return Promise.resolve();
    return new Promise(resolve => {
        el.addEventListener(el.tagName === 'VIDEO' ? 'loadeddata' : 'load', resolve, { once: true });
        el.addEventListener('error', resolve, { once: true });
    });
}

// Whether the labels should turn white over the hero. Read from the same
// luminance grid the corner nav uses; media that can't be read yet is assumed
// dark, which every hero on the site currently is.
function introHeroIsDark(el) {
    const grid = el && toneGrid(el);
    if (!grid) return true;
    let sum = 0;
    for (const v of grid.cells) sum += v;
    return sum / grid.cells.length < TONE_DARK;
}

// The geometry the greeting is drawn from. Each label is placed against its
// corner of the window, so the whole thing is described by the window's size,
// the labels' scale, and how far in from each corner they sit.
function introGeometry(labels, frame) {
    const rects = labels.map(l => l.getBoundingClientRect());
    const [tl, tr, bl, br] = rects;
    const size = parseFloat(getComputedStyle(labels[0]).fontSize);

    // Where each label rests: its distance in from its own corner of the frame.
    const rest = [
        [tl.left - frame.left, tl.top - frame.top],
        [frame.right - tr.right, tr.top - frame.top],
        [bl.left - frame.left, frame.bottom - bl.bottom],
        [frame.right - br.right, frame.bottom - br.bottom],
    ];

    // The block at the labels' natural size: two columns and two rows.
    const colL = Math.max(tl.width, bl.width);
    const colR = Math.max(tr.width, br.width);
    const rowT = Math.max(tl.height, tr.height);
    const rowB = Math.max(bl.height, br.height);
    const gapX = size * 1.4;
    const gapY = size * 0.35;

    // Modest at the start — present, not shouting — and given more of a narrow
    // screen, where the block would otherwise be lost.
    const share = frame.width < 600 ? 0.66 : 0.42;
    const scale = Math.max(1, Math.min(1.8, (frame.width * share) / (colL + gapX + colR)));

    // How far in from the window's corners the labels sit while it is small.
    const inset = size * 0.9 * scale;

    return {
        rects,
        rest,
        scale,
        inset,
        size,
        // The window's half-extents once open, sized so the labels on its corners
        // form the block.
        openHalfW: (inset * 2 + (colL + gapX + colR) * scale) / 2,
        openHalfH: (inset * 2 + (rowT + gapY + rowB) * scale) / 2,
        // Rounded at the start, squared off by the time it fills the frame.
        radius: Math.min(24, size * 0.7 * scale),
    };
}

function initIntro() {
    if (!shouldPlayIntro()) return;

    const root = document.documentElement;
    const nav = document.querySelector('.corner-nav');
    const hero = document.querySelector('[data-intro] .hero');
    if (!nav || !hero || nav.children.length < 4) return;

    // Set synchronously, before the first paint: the stylesheet hides the
    // labels and the hero off this class, so nothing flashes into place while
    // the fonts load and the geometry is measured.
    root.classList.add('is-intro');

    // On a reload the browser restores the previous scroll position, and it does
    // so after this script has run — so a greeting would otherwise play with the
    // page halfway down, half hero and half grid. Restoration is switched off
    // for this load before it can happen, and handed back afterwards.
    const restoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    scrollTo({ top: 0, behavior: 'instant' });

    runIntro(root, nav, hero).finally(() => { history.scrollRestoration = restoration; });
}

async function runIntro(root, nav, hero) {
    const labels = Array.from(nav.children).slice(0, 4);
    const media = hero.querySelector('video, img');

    // Input skips to the end — but not in the first moments after the greeting
    // appears or the window regains focus. Clicking into a browser window to
    // bring it forward is itself a pointerdown on the page, and it used to skip
    // the greeting before anyone had seen it. Until the greeting is on screen,
    // nothing can skip it at all.
    const SKIP_GRACE = 450;
    const skipEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    let skipped = false;
    let graceUntil = Infinity;
    const skip = () => { if (performance.now() >= graceUntil) skipped = true; };
    const regrace = () => { if (graceUntil !== Infinity) graceUntil = performance.now() + SKIP_GRACE; };
    skipEvents.forEach(e => addEventListener(e, skip, { passive: true }));
    addEventListener('focus', regrace);

    // Everything that could hold the greeting up is waited for before it
    // starts, never during it: label widths depend on Monument's metrics, and
    // the window should open onto a frame of the hero. Both are capped, and the
    // screen is simply empty until then.
    const capped = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(r, ms))]);
    await Promise.all([capped(document.fonts.ready, 1500), capped(introMediaReady(media), 1200)]);

    // Nor does it start until someone can see it: a tab opened in the background,
    // or a page Chrome renders ahead of time before Enter is pressed, would
    // otherwise play the whole greeting to nobody.
    const onScreen = () => document.visibilityState === 'visible' && !document.prerendering;
    if (!onScreen()) {
        await new Promise(resolve => {
            const check = () => {
                if (!onScreen()) return;
                document.removeEventListener('visibilitychange', check);
                document.removeEventListener('prerenderingchange', check);
                resolve();
            };
            document.addEventListener('visibilitychange', check);
            document.addEventListener('prerenderingchange', check);
        });
    }

    // Marked seen only now that it is genuinely playing, so a greeting nobody
    // saw doesn't use up the session's one showing.
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch {}

    // Measured at rest, so the rects are the layout's and not the animation's:
    // any transform the greeting has applied is cleared first. Done again
    // whenever the window changes size — a phone's address bar collapsing, a
    // window settling as it opens — so the greeting adapts instead of stopping.
    // Treating a resize as a skip meant it often ended before it was seen.
    let frame, g, cx, cy, fullHalfW, fullHalfH;
    const measure = () => {
        [hero, media, ...labels].forEach(el => el && el.style.removeProperty('transform'));
        if (scrollY !== 0) scrollTo({ top: 0, behavior: 'instant' });
        frame = hero.getBoundingClientRect();
        g = introGeometry(labels, frame);
        cx = frame.left + frame.width / 2;
        cy = frame.top + frame.height / 2;
        fullHalfW = frame.width / 2;
        fullHalfH = frame.height / 2;
    };
    measure();
    let stale = false;
    const markStale = () => { stale = true; };
    addEventListener('resize', markStale);
    // Scrolling is locked while the greeting plays, so any scroll that still
    // arrives is the browser restoring a position; the next frame undoes it.
    addEventListener('scroll', markStale, { passive: true });

    const dark = introHeroIsDark(media);

    // The labels' colour is blended on the same frame as the window, from their
    // resting ink. Each also gets its final class now: the inline colour
    // overrides it while the greeting runs, and clearing that at the end leaves
    // exactly the colour already on screen.
    const ink = (getComputedStyle(labels[0]).color.match(/[\d.]+/g) || [16, 16, 16]).slice(0, 3).map(Number);
    const target = dark ? [255, 255, 255] : ink;
    labels.forEach(label => label.classList.toggle('is-on-dark', dark));

    const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
    const progress = (t, [a, b]) => clamp01((t - a) / (b - a));

    // The window's growth runs on a real cubic-bezier rather than a polynomial,
    // because the polynomial curves were the wrong shape for it. A cubic
    // ease-in-out is symmetric — it spends as long gathering speed as it does
    // settling — and on a window opening onto a full screen that read as a
    // hesitation followed by a rush: a quarter of the time gone before a
    // quarter of the distance was covered.
    //
    // The curves were then compared on two numbers, where each reaches 95% and
    // 99% of the distance. An ease-out shape corrects the hesitation and
    // overcorrects into the opposite fault — one tried here was 95% done at
    // 48% of the run and spent the whole second half creeping through the last
    // one percent, which reads as an animation that will not end. This one is
    // 26% along at a quarter of the time and 99% along at 87%, so it leaves
    // without hesitating and arrives without loitering.
    const easeExpand = cubicBezier(0.38, 0.02, 0.22, 1);
    // The fade and the bloom are small moves and want the opposite: all their
    // speed at the start, then a long quiet arrival.
    const easeOut = cubicBezier(0.16, 1, 0.3, 1);

    // Draws one moment of the greeting. Every element is set from the same t in
    // the same frame, and each label is placed against the window's corner, so
    // nothing can drift out of the frame it rides in.
    const render = t => {
        if (stale) {
            stale = false;
            measure();
        }

        const fade = easeOut(progress(t, INTRO_PHASES.fade));
        const open = easeOut(progress(t, INTRO_PHASES.open));
        const expand = easeExpand(progress(t, INTRO_PHASES.expand));

        // The window's half-extents, growing from open to the full frame. The
        // labels are placed against these; the visible frame additionally blooms
        // in from just inside them as it fades up. Blooming the anchor itself
        // pulled the two columns of labels together until they touched.
        const hw = g.openHalfW + (fullHalfW - g.openHalfW) * expand;
        const hh = g.openHalfH + (fullHalfH - g.openHalfH) * expand;
        const bloom = 0.94 + 0.06 * open;

        // The window is the hero scaled down about its centre, with the media
        // scaled up by exactly the inverse inside it, so the hero's overflow
        // clips the picture while the picture itself holds still. Both are
        // transforms, so the video is never repainted to move the frame —
        // animating a clip-path instead forced a repaint every frame and flickered.
        const sx = (hw * bloom) / fullHalfW;
        const sy = (hh * bloom) / fullHalfH;
        hero.style.opacity = open;
        hero.style.transform = `scale(${sx}, ${sy})`;
        if (media) media.style.transform = `scale(${1 / sx}, ${1 / sy})`;

        // Rounded corners that square off early in the expansion. The radius is
        // given per axis and divided by that axis's scale, or the uneven scaling
        // would stretch the corners into ellipses.
        //
        // Keyed to distance travelled, not to elapsed time: the corners are gone
        // by the time the window has crossed a quarter of the way to the edges,
        // whenever that happens to fall. Firefox draws a rounded clip over video
        // as a mask whose cost grows with the area it covers, so what matters is
        // never how long the rounding lasts but how large the window gets while
        // it is still rounded — and distance is the thing that says so directly.
        //
        // Under the old symmetric curve this had to be keyed to time instead,
        // because that curve crawled at the start and a quarter of the distance
        // was not reached until nearly halfway through, keeping a big rounded
        // mask alive at the fastest part of the motion. The curve above leaves
        // promptly, so a quarter of the distance now falls in the first tenth of
        // the time, while the window is still small. Once the radius reaches
        // zero the clip is a plain rectangle, which costs nothing.
        const square = clamp01(expand / 0.15);
        const r = g.radius * (1 - square) ** 2;
        hero.style.borderRadius = r > 0 ? `${r / sx}px / ${r / sy}px` : '0px';

        // Each label is pinned to its corner of the window, shrinking to label
        // size and settling to its resting distance from the corner as the
        // window reaches the frame's edges.
        const left = cx - hw;
        const right = cx + hw;
        const top = cy - hh;
        const bottom = cy + hh;
        const s = g.scale + (1 - g.scale) * expand;
        const lift = g.size * 0.3 * g.scale * (1 - fade);
        const tone = `rgb(${ink.map((v, i) => Math.round(v + (target[i] - v) * open))})`;

        labels.forEach((el, i) => {
            const rect = g.rects[i];
            const ix = g.inset + (g.rest[i][0] - g.inset) * expand;
            const iy = g.inset + (g.rest[i][1] - g.inset) * expand;
            const onRight = i === 1 || i === 3;
            const onBottom = i === 2 || i === 3;
            const x = onRight ? right - ix - rect.width * s : left + ix;
            const y = onBottom ? bottom - iy - rect.height * s : top + iy;

            el.style.transform = `translate(${x - rect.left}px, ${y - rect.top + lift}px) scale(${s})`;
            el.style.opacity = fade;
            // A soft focus, not a smear. At 4px the words arrived as a blurred
            // shape that resolved into type, which is a video effect; at 2.5px
            // over a shorter fade they simply arrive slightly out of focus, and
            // the eye reads them as settling rather than as an effect.
            el.style.filter = fade < 1 ? `blur(${2.5 * (1 - fade)}px)` : 'none';
            el.style.color = tone;
        });
    };

    await new Promise(resolve => {
        let start = null;
        const tick = now => {
            if (start === null) {
                start = now;
                graceUntil = now + SKIP_GRACE;
            }
            const t = skipped ? INTRO_END : now - start;
            render(t);
            if (t >= INTRO_END) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

    // Hand back. The last frame drawn equals every element's natural style, so
    // clearing the inline styles and dropping the class changes nothing on
    // screen — it only returns control to the stylesheet and the tone system.
    skipEvents.forEach(e => removeEventListener(e, skip));
    removeEventListener('focus', regrace);
    removeEventListener('resize', markStale);
    removeEventListener('scroll', markStale);
    [hero, media, ...labels].forEach(el => {
        if (!el) return;
        ['transform', 'opacity', 'filter', 'color', 'border-radius']
            .forEach(prop => el.style.removeProperty(prop));
    });
    root.classList.remove('is-intro');
    // Let the corner nav's first real reading fade rather than snap, in case a
    // corner disagrees with the one colour the intro chose for all four.
    nav.classList.remove('is-tone-pending');
    dispatchEvent(new Event('backdropchange'));
}

// ─── POINTER TONE ─────────────────────────────────────────────────────────────

// The cursor over a piece of work is a mark on the artwork exactly as the
// corner labels are, and it has the same problem: an ink cross disappears on a
// dark frame and a white one on a pale sky. So it is coloured the same way, by
// the same sampler — the difference being that a label sits still and reads the
// pixels it happens to cover, while this reads the pixels directly under the
// pointer as it moves.
//
// The class lands on whatever owns the cursor rule: the block itself on a case
// study, the whole overlay once the viewer is open, since in there the pointer
// is over one picture wherever it goes.
function initPointerTone() {
    const MEDIA = '.case-block img, .case-block video, .research-item img, .research-item video, ' +
                  '.viewer-slide img, .viewer-slide video';
    if (!document.querySelector('.viewer-item')) return;

    // A drawn cursor is only right for a mouse. A finger has no hover state to
    // read and nothing to follow, and a system cursor set by assistive software
    // should not be taken away, so on anything else the url() rules stand.
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const el = document.createElement('div');
    el.className = 'cursor';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
        '<svg viewBox="0 0 56 56" width="56" height="56" fill="none">' +
        '<line x1="5" y1="28" x2="51" y2="28"/>' +
        '<line class="cursor-upright" x1="28" y1="5" x2="28" y2="51"/>' +
        '</svg>';
    document.body.appendChild(el);
    document.documentElement.classList.add('has-drawn-cursor');

    let queued = false;
    let x = -100;
    let y = -100;

    function update() {
        queued = false;

        // Position first and unconditionally: the mark must keep up with the
        // pointer even while it is fading out.
        el.style.translate = x + 'px ' + y + 'px';

        // Inside the viewer the pointer is over one picture wherever it goes,
        // and the mark means the way out rather than the way in.
        const open = document.documentElement.classList.contains('viewer-open');
        const media = document.elementsFromPoint(x, y).find(m => m.matches(MEDIA));
        // .research-item belongs here as much as .case-block: both hide the
        // system pointer and expect this one to take its place, so a piece
        // missing from this list is a piece with no cursor at all.
        const over = open || (media && media.closest('.case-block, .research-item'));

        el.classList.toggle('is-visible', !!over);
        el.classList.toggle('is-minus', open);

        if (!media) return;
        const lum = luminanceAt(media, media.getBoundingClientRect(), x, y);
        // null means the grid is not ready — a video still decoding, say.
        // Holding the current colour beats flicking to the wrong one.
        if (lum === null) return;
        el.classList.toggle('is-on-dark', lum < TONE_DARK);
    }

    addEventListener('pointermove', e => {
        x = e.clientX;
        y = e.clientY;
        if (queued) return;
        queued = true;
        requestAnimationFrame(update);
    }, { passive: true });

    // Opening and closing need not involve moving the pointer, so the viewer
    // says when it has changed rather than waiting for the next move.
    addEventListener('viewertoggle', () => requestAnimationFrame(update));

    // Leaving the window entirely: without this the mark is left behind at the
    // edge of the screen.
    addEventListener('pointerout', e => {
        if (!e.relatedTarget) el.classList.remove('is-visible');
    });
}

// ─── START ────────────────────────────────────────────────────────────────────

// Every navigation is a real page load, so this runs once per page and there is
// nothing to tear down. Each init returns early when its page has none of what
// it needs, which is why none of them are gated on the page's identity.

// First: it has to claim the labels before the corner nav takes its first
// reading of them.
initIntro();
initViewer();
initCornerNav();
initVideos();
initHeroPair();
// After initViewer, which is what builds the slides this reads.
initPointerTone();
