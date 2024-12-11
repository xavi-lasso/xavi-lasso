
// BACKGROOUND COLOR BUTTON

let isLight = true; // Track the current color state
let rotation = 0; // Track cumulative rotation

const toggleButton = document.getElementById("colorToggle");

toggleButton.addEventListener("click", () => {
  // Toggle the background color
  document.body.style.backgroundColor = isLight ? "#221F1D" : "#b4aeaa";
  isLight = !isLight;

  // Increment rotation by 180 degrees
  rotation += 180;
  toggleButton.style.transform = `rotate(${rotation}deg)`;
});

// INFO - GALLERY SWITCH

const showInfo = document.getElementById("showInfo");
const showGallery = document.getElementById("showGallery");
const gallery = document.getElementById("gallery");
const infoElements = document.querySelectorAll(".info");

// Show all "info" elements and hide the gallery
showInfo.addEventListener("click", () => {
  gallery.classList.add("hidden"); // Fade out the gallery
  infoElements.forEach((info) => {
    info.classList.add("visible"); // Fade in all info elements
  });
});

// Show the gallery and hide all "info" elements
showGallery.addEventListener("click", () => {
  infoElements.forEach((info) => {
    info.classList.remove("visible"); // Fade out all info elements
  });
  gallery.classList.remove("hidden"); // Fade in the gallery
});