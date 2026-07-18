'use strict';

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('phone').value.replace(/[^\d+]/g, '');
  if (!phone) return;
  await window.yawf.openChat(phone);
  window.close();
});
