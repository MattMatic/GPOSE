/* Double Tap Detector for touch

Usage:

  const box = document.getElementById("box");
  const detector = new DoubleTapDetector(box, () => {
    console.log("Double tap detected!");
  });
 
*/

class DoubleTapDetector {
  constructor(element, callback, options = {}) {
    this.element = element;
    this.callback = callback;

    this.delay = options.delay || 300;          // max time between taps
    this.maxDistance = options.maxDistance || 30; // px movement allowed

    this.lastTapTime = 0;
    this.lastX = 0;
    this.lastY = 0;

    this.onTouchStart = this.onTouchStart.bind(this);

    // Prevent iOS double‑tap zoom
    this.element.style.touchAction = "manipulation";

    this.element.addEventListener("touchend", this.onTouchStart, {
      passive: true
    });
  }

  onTouchStart(event) {
    const touch = event.changedTouches[0];
    const now = Date.now();
    
    const timeSinceLast = now - this.lastTapTime;
    const dx = touch.clientX - this.lastX;
    const dy = touch.clientY - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (timeSinceLast > 0 &&
        timeSinceLast < this.delay &&
        distance < this.maxDistance) {
      this.callback(event);
    }

    this.lastTapTime = now;
    this.lastX = touch.clientX;
    this.lastY = touch.clientY;
  }

  destroy() {
    this.element.removeEventListener("touchend", this.onTouchStart);
  }
}