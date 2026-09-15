document.querySelectorAll('.messages .message').forEach((message) => {
  window.setTimeout(() => message.parentElement.remove(), 3500);
});
