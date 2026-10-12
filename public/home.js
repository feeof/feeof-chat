document.getElementById('embed-code').textContent =
  '<script src="' + location.origin + '/widget.js" async></' + 'script>';
document.getElementById('open-chat').addEventListener('click', function () {
  if (window.FeeofChat) window.FeeofChat.open();
});
