
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

setInterval(()=>{
  const time = document.querySelector("#time");
  let date = new Date();
  let hours = date.getHours();
  let minutes = date.getMinutes();
  let seconds = date.getSeconds();
  let day_night = "AM";
  // if(hours > 12){
  //     hours = hours - 12;
  //     day_night = "PM";
  // } 
  if ( hours < 10){
      hours = "0" + hours;
  }
  if (minutes < 10) {
      minutes = "0" + minutes;
  }
  if (seconds < 10) {
  seconds = "0" + seconds;
  }
  time.textContent = hours + ":" + minutes + ":" + seconds;
 }

 )