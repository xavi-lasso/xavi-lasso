
// barba.init({
//   transitions: [{
//     name: 'default-transition',
//     leave() {
//       gsap.to(".main, .bioContainer", {duration:2, opacity: 0});
//       gsap.to(".main, .bioContainer", {duration:1, x:-600, ease: "power3"});
//       // create your stunning leave animation here
//     },
//     enter() {
//       gsap.from(".main, .bioContainer", {duration:2, opacity: 0});
//       gsap.from(".main, .bioContainer", {duration:1, x:600, ease: "power3"});
//       // create your amazing enter animation here
//     }
//   }]
// });

barba.init({
  transitions: [{
    name: 'opacity-transition',
    leave(data) {
      return gsap.to(data.current.container, {
        opacity: 0
      });
    },
    enter(data) {
      return gsap.from(data.next.container, {
        opacity: 0
      });
    }
  }]
});