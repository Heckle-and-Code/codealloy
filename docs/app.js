// CodeAlloy Official Site Scripts & Simulators

document.addEventListener('DOMContentLoaded', () => {
  initOsDetection();
  initReleaseApi();
  initAutonomyDial();
  initDiffViewer();
});

// 1. Operating System Detection & Smart Download Routing
function initOsDetection() {
  const ua = window.navigator.userAgent.toLowerCase();
  const platform = (window.navigator.userAgentData?.platform || window.navigator.platform || '').toLowerCase();

  let osLabel = 'Download for macOS (Apple Silicon)';
  let targetPattern = 'darwin-arm64.dmg';

  if (platform.includes('win') || ua.includes('windows')) {
    osLabel = 'Download for Windows (.zip / exe)';
    targetPattern = 'win32-x64.zip';
  } else if (platform.includes('linux') || ua.includes('linux')) {
    osLabel = 'Download for Linux (.deb / tar)';
    targetPattern = 'amd64.deb';
  } else if (platform.includes('mac') || ua.includes('macintosh')) {
    if (ua.includes('intel') && !navigator.maxTouchPoints) {
      osLabel = 'Download for macOS (Intel)';
      targetPattern = 'darwin-x64.dmg';
    }
  }

  const primaryBtn = document.getElementById('primaryDownloadBtn');
  const dropdownToggle = document.getElementById('downloadDropdownToggle');
  const dropdownMenu = document.getElementById('downloadDropdownMenu');

  if (primaryBtn) {
    primaryBtn.textContent = `⚡ ${osLabel}`;
    primaryBtn.setAttribute('data-asset-match', targetPattern);
    primaryBtn.href = `https://github.com/Heckle-and-Code/codealloy/releases/latest`;
  }

  // Dropdown Toggle
  if (dropdownToggle && dropdownMenu) {
    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dropdownMenu.classList.remove('show');
    });
  }
}

// 2. Dynamic GitHub Releases Fetcher (Automatically syncs to newest release)
async function initReleaseApi() {
  const releaseStatusEl = document.getElementById('releaseStatusPill');

  try {
    // Query GitHub releases (handles both standard releases and alpha prereleases)
    const res = await fetch('https://api.github.com/repos/Heckle-and-Code/codealloy/releases');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const releases = await res.json();
    if (!Array.isArray(releases) || releases.length === 0) return;

    const latestRelease = releases[0];
    const tag = latestRelease.tag_name;
    const assets = latestRelease.assets || [];

    if (releaseStatusEl) {
      releaseStatusEl.innerHTML = `<span class="badge-dot"></span> Latest Release: <strong>${tag}</strong>`;
    }

    // Automatically map latest release assets to ALL matching download buttons (hero, dropdown, cards)
    if (assets.length > 0) {
      assets.forEach(asset => {
        const name = asset.name;
        const sizeMb = (asset.size / (1024 * 1024)).toFixed(1);
        const url = asset.browser_download_url;

        document.querySelectorAll(`[data-asset-match]`).forEach(link => {
          const matchPattern = link.getAttribute('data-asset-match');
          if (matchPattern && name.includes(matchPattern)) {
            link.href = url;
            const sizeLabel = link.querySelector('.asset-size');
            if (sizeLabel) sizeLabel.textContent = `(${sizeMb} MB)`;
          }
        });
      });
    }
  } catch (err) {
    console.warn('Could not fetch latest release dynamically, using default links:', err);
  }
}

// 3. Interactive Autonomy Dial Simulator
function initAutonomyDial() {
  const levels = {
    l0: {
      tag: 'L0: Assist',
      badgeClass: 'safe',
      heading: 'Level 0 — Passive Autocomplete & Search',
      text: 'The model acts only when triggered. It predicts the next tokens as ghost-text in your editor or answers queries without touching any filesystem APIs.',
      actionCard: `
        <div style="color: #9DA3B4; margin-bottom: 8px;">// Model Ghost Suggestion:</div>
        <div style="color: #4EBD79;">+ function verifySignature(payload, secret) {</div>
        <div style="color: #656B7D; font-size: 0.8rem; margin-top: 6px;">[Press Tab to accept inline ghost text]</div>
      `
    },
    l1: {
      tag: 'L1: Chat',
      badgeClass: 'safe',
      heading: 'Level 1 — Interactive Model Chat',
      text: 'Engage in multi-turn discussions with your open weights model in the sidebar. The model analyzes your selected code, suggests architectural patterns, but makes zero disk edits.',
      actionCard: `
        <div style="color: #78DCE8; margin-bottom: 6px;">Qwen 2.5 Coder:</div>
        <div style="color: #E2E4EB;">"I recommend wrapping the SQLite transaction in an atomic try-finally block to prevent deadlocks."</div>
      `
    },
    l2: {
      tag: 'L2: Supervised',
      badgeClass: 'supervised',
      heading: 'Level 2 — Supervised 1-Click Diff Approvals',
      text: 'The default paired programming mode. The model autonomously formulates edits and shell commands, but pauses execution to present an interactive diff card for your explicit approval.',
      actionCard: `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <strong style="color: #FFAE19;">Action Required: write_file</strong>
          <span style="color: #656B7D;">src/auth.ts</span>
        </div>
        <div style="background: #14151A; padding: 10px; border-radius: 6px; margin-bottom: 10px;">
          <span style="color: #4EBD79;">+ export const hashPassword = async (pwd) =&gt; { ... }</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <span style="background: #FF8C00; color: #121316; padding: 4px 10px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">Approve [Enter]</span>
          <span style="background: #2A2E3B; color: #E2E4EB; padding: 4px 10px; border-radius: 4px; font-size: 0.75rem;">Reject [Esc]</span>
        </div>
      `
    },
    l3: {
      tag: 'L3: Guarded',
      badgeClass: 'guarded',
      heading: 'Level 3 — Guarded Workspace Auto-Execution',
      text: 'Fast iteration mode. Edits and safe terminal commands inside the workspace root run automatically without interruption. The circuit breaker halts only on dangerous commands (rm -rf, sudo, or touching files outside workspace).',
      actionCard: `
        <div style="color: #10B981; margin-bottom: 6px;">⚡ Auto-Executed in Workspace:</div>
        <div style="color: #E2E4EB; font-family: monospace;">✓ Created src/models/user.ts</div>
        <div style="color: #E2E4EB; font-family: monospace;">✓ Executed: npm test (2 passed)</div>
        <div style="color: #78DCE8; margin-top: 8px;">Shadow Git Snapshot: #3a8f1e (sub-5ms)</div>
      `
    },
    l4: {
      tag: 'L4: Autonomous',
      badgeClass: 'autonomous',
      heading: 'Level 4 — Autonomous Goal Runner Loop',
      text: 'Assign a high-level goal (e.g. "Fix all failing auth tests"). The agent iterates autonomously: Plan → Edit → Test → Inspect Error → Self-Heal. Equipped with loop-detection circuit breakers.',
      actionCard: `
        <div style="color: #AB9DF2; margin-bottom: 6px;">🔄 Goal Loop (Turn 4 / 25):</div>
        <div style="color: #E2E4EB;">Running test suite... Error: Port 3000 in use.</div>
        <div style="color: #FFAE19; margin-top: 4px;">Self-Healing: Adjusting test runner port to 3001...</div>
        <div style="color: #10B981; margin-top: 4px;">✓ Tests passed (100% green). Goal achieved!</div>
      `
    }
  };

  const buttons = document.querySelectorAll('.autonomy-btn');
  const badgeEl = document.getElementById('simBadge');
  const headingEl = document.getElementById('simHeading');
  const textEl = document.getElementById('simText');
  const actionCardEl = document.getElementById('simActionCard');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const levelKey = btn.getAttribute('data-level');
      const data = levels[levelKey];
      if (data) {
        badgeEl.textContent = data.tag;
        badgeEl.className = `sim-badge ${data.badgeClass}`;
        headingEl.textContent = data.heading;
        textEl.textContent = data.text;
        actionCardEl.innerHTML = data.actionCard;
      }
    });
  });
}

// 4. Interactive Inline Diff Reviewer Widget
function initDiffViewer() {
  const acceptBtn = document.getElementById('diffAcceptBtn');
  const rejectBtn = document.getElementById('diffRejectBtn');
  const diffViewer = document.getElementById('diffViewer');
  const statusMsg = document.getElementById('diffStatusMsg');

  if (!acceptBtn || !rejectBtn || !diffViewer) return;

  acceptBtn.addEventListener('click', () => {
    diffViewer.innerHTML = `
      <div class="diff-line context"><span style="width: 24px;">1</span> import { SovereignEngine } from '@codealloy/core';</div>
      <div class="diff-line" style="background: rgba(16, 185, 129, 0.15); color: #10B981;"><span style="width: 24px;">2</span> const engine = new SovereignEngine({ provider: 'ollama' });</div>
      <div class="diff-line context"><span style="width: 24px;">3</span> await engine.start();</div>
    `;
    if (statusMsg) {
      statusMsg.innerHTML = '<span style="color: #10B981;">✓ Diff accepted and persisted to buffer!</span>';
    }
  });

  rejectBtn.addEventListener('click', () => {
    diffViewer.innerHTML = `
      <div class="diff-line context"><span style="width: 24px;">1</span> import { SovereignEngine } from '@codealloy/core';</div>
      <div class="diff-line context"><span style="width: 24px;">2</span> const engine = new SovereignEngine();</div>
      <div class="diff-line context"><span style="width: 24px;">3</span> await engine.start();</div>
    `;
    if (statusMsg) {
      statusMsg.innerHTML = '<span style="color: #D9381E;">✕ Changes reverted to original state.</span>';
    }
  });
}
