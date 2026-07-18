'use strict';

const rowsEl = document.getElementById('rows');
const totalsEl = document.getElementById('totals');

function render(metrics) {
  let totalMb = 0;
  let totalCpu = 0;
  rowsEl.innerHTML = '';

  for (const m of metrics.sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)) {
    const mb = Math.round(m.memory.workingSetSize / 1024);
    const cpu = m.cpu.percentCPUUsage.toFixed(1);
    totalMb += mb;
    totalCpu += m.cpu.percentCPUUsage;

    const tr = document.createElement('tr');
    if (m.type === 'Browser') tr.className = 'browser';
    tr.innerHTML = `<td class="type">${m.type}</td><td>${m.pid}</td><td>${cpu}</td><td>${mb}</td>`;
    rowsEl.appendChild(tr);
  }

  totalsEl.textContent = `${metrics.length} processes - ${totalMb} MB total - ${totalCpu.toFixed(1)}% CPU total`;
}

async function tick() {
  const metrics = await window.yawf.getMetrics();
  render(metrics);
}

tick();
const interval = setInterval(tick, 2000);
window.addEventListener('beforeunload', () => clearInterval(interval));
