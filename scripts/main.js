
//**** Time ****

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

// **** Follow Mouse ****
 
     TweenMax.from(".cursor-follow", 2, {
         delay: 1,
         opacity: 0
     });

     follower = document.querySelector('.cursor-follow');

     posX = 0;
     posY = 0;
     mouseX = 0;
     mouseY = 0;

     TweenMax.to({}, 0.016, {
         repeat: -1,
         onRepeat: function () {
             posX += (mouseX - posX) / 9;
             posY += (mouseY - posY) / 9;

             TweenMax.set(follower, {
                 css: {
                     left: posX - 200,
                     top: posY - 250,
                 }
             });
         }
     });

     document.addEventListener("mousemove", function (e) {
     mouseX = e.pageX;
     mouseY = e.pageY;
 });
