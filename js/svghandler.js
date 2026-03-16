// SVG Handling
// github.com/MattMatic


function DownloadSvg(fileName) {
  var tempLink = document.createElement("a");
  var taBlob = new Blob([svgResult.innerHTML.replace(' height="512"', '')], { type: 'text/plain' });
  tempLink.setAttribute('href', URL.createObjectURL(taBlob));
  tempLink.setAttribute('download', `${fileName}.svg`);
  tempLink.click();
  URL.revokeObjectURL(tempLink.href);
}

function updateSvg(dive, html) {
  var oldScale = 1;
  var oldTranslate = {x:0, y:0};

  var svge = dive.children[0];
  if (typeof svge !== 'undefined') {
    oldScale = svge.currentScale;
    oldTranslate = svge.currentTranslate;
  }
  dive.innerHTML = html;
  svge = dive.children[0];
  svge.currentScale = oldScale;
  svge.currentTranslate.x = oldTranslate.x;
  svge.currentTranslate.y = oldTranslate.y;
  addSVGZoomAndPan(dive.children[0]);
}

function adjustSVGzoom(svge, amount) {
  var newScale
  if (amount < 0){newScale=svge.currentScale/1.1}
  if (amount > 0){newScale=svge.currentScale*1.1}
  if (amount ==0){newScale=1}
  var oldScale=svge.currentScale
  var y = svge.clientHeight / 2;
  svge.currentTranslate.y=(-y+svge.currentTranslate.y)*(newScale/oldScale)
  svge.currentTranslate.x=(0+svge.currentTranslate.x)*(newScale/oldScale)
  svge.currentScale=newScale
  svge.currentTranslate.y+=y;
  svge.currentTranslate.x+=0;
}

function zoomSVG(amount) {
  const svge = svgResult.children[0];
  adjustSVGzoom(svge, amount);
  if (amount==0) {
    svge.currentTranslate.y = 0;
    svge.currentTranslate.x = 0;
  }
}

function addSVGZoomAndPan(svg){
  // From https://github.com/Holger-Will/SVGZoomAndPan/blob/master/zap.js
  svg.addEventListener("wheel",function(evt){
    if (evt.shiftKey) {
      // Only zoom while the shift key is pressed (to allow scrolling the page)
      var newScale
      if(evt.deltaY>0){newScale=svg.currentScale/1.1}
      if(evt.deltaY<0){newScale=svg.currentScale*1.1}
      var oldScale=svg.currentScale
       svg.currentTranslate.x=(-evt.offsetX+svg.currentTranslate.x)*(newScale/oldScale)
       svg.currentTranslate.y=(-evt.offsetY+svg.currentTranslate.y)*(newScale/oldScale)
       svg.currentScale=newScale
       svg.currentTranslate.x+=evt.offsetX
       svg.currentTranslate.y+=evt.offsetY
       var event = new Event('SVGZoom');
       svg.dispatchEvent(event);
       evt.preventDefault();  // Stop window from scrolling (update to zap.js)
     }
  } /*, {passive:true}*/)
  svg.addEventListener("mousedown",function(evt){
    if(!evt.shiftKey || evt.button==1){
      svg.classList.add("dragging")
      var ox=evt.offsetX
      var oy=evt.offsetY
      var otx=svg.currentTranslate.x
      var oty=svg.currentTranslate.y
      svg.addEventListener("mousemove",move)
      document.addEventListener("mouseup",out)
      var event = new Event('SVGScroll');
      svg.dispatchEvent(event)
      function out(evt){
        svg.removeEventListener("mousemove",move)
        document.removeEventListener("mouseup",out)
        svg.classList.remove("dragging")
        var event = new Event('SVGScroll');
        svg.dispatchEvent(event)
      }
      function move(evt){
        svg.currentTranslate.x=otx+(evt.offsetX-ox)
        svg.currentTranslate.y=oty+(evt.offsetY-oy)
        var event = new Event('SVGScroll');
        svg.dispatchEvent(event)
      }
    }
  })
}
