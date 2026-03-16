//------------------------------
// Drag and drop utilities
//------------------------------

function chooseFile(func, options={}) {
  const { multiple=false } = options;
  let filein = document.createElement('input');
  filein.type = 'file';
  filein.multiple = multiple;
  filein.onchange = e => {
    let file = e.target.files[0];
    func(file, e, e.target.files);
  }
  filein.click();
  try {
    document.body.removeChild(filein);
  } catch (e) {
    // ignore
  }
}

function ddCancel(e) {e.stopPropagation();e.preventDefault();}
function patchDragDrop(ele, foo, options) {
  //const ele = document.getElementById(id);
  ele.addEventListener('dragover', (e) => {
    ddCancel(e);
    ele.style.backgroundColor = 'yellow';
    }, false);
  ele.addEventListener('dragleave', (e) => {
    ddCancel(e);
    ele.style.backgroundColor = null;
    }, false);
  ele.addEventListener('drop', (e) => {
    ddCancel(e);
    const file = e.dataTransfer.files[0];
    ele.style.backgroundColor = null;
    foo(file, ele, e.dataTransfer.files);
  });
  ele.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      chooseFile(foo, options);
    }
  });
}
document.addEventListener('dragover', ddCancel, false);
document.addEventListener('dragleave', ddCancel, false);
document.addEventListener('drop', ddCancel, false);
