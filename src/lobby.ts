import { playerOptions } from './playerOptions';
import { onGameAssetPreloadChange } from './assets/AssetPreloader';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SERVER_URL: string = ((import.meta as any).env?.VITE_SERVER_URL) ?? 'http://localhost:3001';

const COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1',
];

const css = `
  @keyframes lb-pulse {
    0%, 100% { text-shadow: 0 0 40px rgba(255,180,50,0.5), 0 0 80px rgba(255,120,0,0.25); }
    50%       { text-shadow: 0 0 60px rgba(255,180,50,0.7), 0 0 120px rgba(255,120,0,0.4); }
  }
  @keyframes lb-blink {
    0%, 100% { opacity: 0.85; }
    50%       { opacity: 0.45; }
  }
  #lobby-root {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: linear-gradient(180deg, rgba(10,10,30,0.98) 0%, rgba(0,0,0,0.95) 100%);
    font-family: 'Inter', system-ui, sans-serif;
    color: #fff; overflow-y: auto; padding: 24px 0;
  }
  .lb-load-track {
    position: fixed; top: 0; left: 0; right: 0;
    height: 3px; background: rgba(255,255,255,0.08);
    z-index: 1;
  }
  .lb-load-bar {
    width: 0%; height: 100%;
    background: linear-gradient(90deg, #ffb432, #ff6a00);
    transition: width 0.25s ease;
  }
  .lb-title {
    font-family: 'Russo One', sans-serif;
    font-size: 5rem; letter-spacing: 0.06em;
    color: #fff; text-transform: uppercase; line-height: 1;
    animation: lb-pulse 3s ease-in-out infinite;
  }
  .lb-title .accent { color: #ffb432; }
  .lb-divider {
    width: 80px; height: 3px; border: none;
    background: linear-gradient(90deg, transparent, #ffb432, transparent);
    margin: 0.75rem 0 0.5rem;
  }
  .lb-tagline {
    font-size: 0.88rem; font-weight: 500;
    color: rgba(255,255,255,0.42); letter-spacing: 0.25em;
    text-transform: uppercase; margin-bottom: 1.6rem;
  }
  .lb-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px; padding: 24px 32px;
    width: 420px; max-width: 92vw;
    display: flex; flex-direction: column; gap: 18px;
  }
  .lb-label {
    font-size: 10px; letter-spacing: 0.18em;
    text-transform: uppercase; opacity: 0.42; margin-bottom: 7px;
  }
  .lb-mode-row { display: flex; gap: 10px; }
  .lb-mode-btn {
    flex: 1; padding: 11px 0; border-radius: 10px; cursor: pointer;
    border: 2px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.42); font-size: 13px; font-weight: 600;
    letter-spacing: 0.05em; transition: all 0.15s; font-family: inherit;
  }
  .lb-mode-btn:hover { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.75); }
  .lb-mode-btn.active { background: rgba(255,180,50,0.12); border-color: #ffb432; color: #ffb432; }
  .lb-nick {
    width: 100%; box-sizing: border-box;
    padding: 9px 13px; border-radius: 8px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.13);
    color: #fff; font-size: 15px; outline: none;
    transition: border-color 0.15s; font-family: inherit;
  }
  .lb-nick:focus { border-color: rgba(255,180,50,0.55); }
  .lb-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
  .lb-swatch {
    width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
    border: 3px solid transparent;
    transition: transform 0.12s, border-color 0.12s;
    flex-shrink: 0;
  }
  .lb-swatch:hover:not(.taken) { transform: scale(1.18); }
  .lb-swatch.active { border-color: #fff; transform: scale(1.1); }
  .lb-swatch.taken { opacity: 0.2; cursor: not-allowed; pointer-events: none; }
  .lb-count {
    text-align: center; font-size: 11px; letter-spacing: 0.2em;
    text-transform: uppercase; color: #ffb432;
    animation: lb-blink 2s ease-in-out infinite;
    display: none;
  }
  .lb-assets {
    min-height: 14px; text-align: center;
    font-size: 10px; letter-spacing: 0.18em;
    text-transform: uppercase; color: rgba(255,255,255,0.36);
  }
  .lb-play {
    padding: 13px 0; border-radius: 12px;
    background: linear-gradient(90deg, #ffb432, #ff6a00);
    color: #111; font-size: 17px; font-weight: 800;
    letter-spacing: 0.12em; cursor: pointer; border: none;
    transition: opacity 0.15s, transform 0.1s;
    text-transform: uppercase; font-family: 'Russo One', sans-serif;
  }
  .lb-play:hover { opacity: 0.9; transform: translateY(-1px); }
  .lb-play:disabled { opacity: 0.5; cursor: wait; transform: none; }
  .lb-play:active { transform: translateY(1px); }
  .lb-footer {
    margin-top: 1.2rem; color: rgba(255,255,255,0.2);
    font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase;
  }
  @media (max-width: 600px) {
    .lb-title { font-size: 3rem; }
    .lb-tagline { font-size: 0.75rem; }
    .lb-card { padding: 18px 20px; gap: 14px; }
  }
`;

export function showLobby(worldReadyPromise: Promise<void> = Promise.resolve()): Promise<void> {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'lobby-root';
    root.innerHTML = `
      <div class="lb-load-track"><div class="lb-load-bar" id="lb-load-bar"></div></div>
      <div class="lb-title">City <span class="accent">Dash</span></div>
      <hr class="lb-divider" />
      <div class="lb-tagline">Deliver More. Earn More.</div>
      <div class="lb-card">
        <div>
          <div class="lb-label">Mode</div>
          <div class="lb-mode-row">
            <button class="lb-mode-btn active" data-mode="single">Solo</button>
            <button class="lb-mode-btn" data-mode="multi">Multiplayer</button>
          </div>
        </div>
        <div>
          <div class="lb-label">Nickname</div>
          <input class="lb-nick" type="text" maxlength="20" placeholder="Your name" value="Player" />
        </div>
        <div>
          <div class="lb-label">Car Color</div>
          <div class="lb-swatches" id="lb-car"></div>
        </div>
        <div>
          <div class="lb-label">Shirt Color</div>
          <div class="lb-swatches" id="lb-shirt"></div>
        </div>
        <div class="lb-count" id="lb-count"></div>
        <div class="lb-assets" id="lb-assets"></div>
        <button class="lb-play">PLAY</button>
      </div>
      <div class="lb-footer">A Vibe Jam 2026 Game</div>
    `;
    document.body.appendChild(root);
    const playButton = root.querySelector<HTMLButtonElement>('.lb-play')!;
    const assetEl = root.querySelector<HTMLElement>('#lb-assets')!;
    const loadBar = root.querySelector<HTMLElement>('#lb-load-bar')!;
    let assetsReady = false;
    let worldReady = false;

    const syncReadiness = () => {
      const ready = assetsReady && worldReady;
      playButton.disabled = !ready;

      if (ready) {
        loadBar.style.width = '100%';
        assetEl.textContent = 'Ready';
      } else if (assetsReady) {
        loadBar.style.width = '95%';
        assetEl.textContent = 'Building city';
      }
    };

    worldReadyPromise.then(() => {
      worldReady = true;
      syncReadiness();
    }).catch((error) => {
      console.error('Failed to prepare game before lobby start:', error);
      worldReady = true;
      syncReadiness();
    });

    const unsubscribeAssets = onGameAssetPreloadChange((state) => {
      const progress = state.total > 0 ? state.loaded / state.total : 0;
      loadBar.style.width = `${Math.round(progress * 90)}%`;

      if (state.status === 'loading') {
        assetEl.textContent = `Preparing city ${state.loaded} / ${state.total}`;
        playButton.disabled = true;
        return;
      }

      assetsReady = true;
      assetEl.textContent = state.status === 'error'
        ? 'Assets warmed with fallback available'
        : 'Assets ready';
      syncReadiness();
    });

    // Mode buttons
    const modeBtns = root.querySelectorAll<HTMLButtonElement>('.lb-mode-btn');
    modeBtns.forEach(btn => btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      playerOptions.mode = btn.dataset.mode as 'single' | 'multi';
      syncCount();
    }));

    // Nickname
    const nickInput = root.querySelector<HTMLInputElement>('.lb-nick')!;
    nickInput.addEventListener('input', () => { playerOptions.nickname = nickInput.value.trim() || 'Player'; });

    // Swatches — independent per row, multiplayer taken state from server
    const carRow = root.querySelector<HTMLElement>('#lb-car')!;
    const shirtRow = root.querySelector<HTMLElement>('#lb-shirt')!;

    const buildSwatches = (
      row: HTMLElement,
      initial: string,
      onPick: (c: string) => void,
    ): ((taken: string[]) => void) => {
      for (const c of COLORS) {
        const sw = document.createElement('div');
        sw.className = 'lb-swatch' + (c === initial ? ' active' : '');
        sw.style.background = c;
        sw.dataset.color = c;
        sw.addEventListener('click', () => {
          row.querySelectorAll('.lb-swatch').forEach(s => s.classList.remove('active'));
          sw.classList.add('active');
          onPick(c);
        });
        row.appendChild(sw);
      }
      return (taken: string[]) => {
        row.querySelectorAll<HTMLElement>('.lb-swatch').forEach(s => {
          const isTaken = taken.includes(s.dataset.color ?? '');
          s.classList.toggle('taken', isTaken);
          if (isTaken && s.classList.contains('active')) {
            s.classList.remove('active');
            const free = row.querySelector<HTMLElement>('.lb-swatch:not(.taken)');
            if (free) { free.classList.add('active'); onPick(free.dataset.color!); }
          }
        });
      };
    };

    const updateCarTaken   = buildSwatches(carRow,   playerOptions.carColor,   c => { playerOptions.carColor = c; });
    const updateShirtTaken = buildSwatches(shirtRow, playerOptions.shirtColor, c => { playerOptions.shirtColor = c; });

    // Connected players counter (multiplayer only)
    const countEl = root.querySelector<HTMLElement>('#lb-count')!;
    let poll: ReturnType<typeof setInterval> | null = null;

    const fetchCount = () => {
      fetch(`${SERVER_URL}/status`)
        .then(r => r.json())
        .then(({ playerCount, maxPlayers }: { playerCount: number; maxPlayers: number }) => {
          countEl.textContent = `${playerCount} / ${maxPlayers} players online`;
          countEl.style.display = 'block';
        })
        .catch(() => {
          countEl.textContent = 'server unreachable';
          countEl.style.display = 'block';
        });
    };

    const fetchColors = () => {
      fetch(`${SERVER_URL}/colors`)
        .then(r => r.json())
        .then(({ takenCarColors, takenShirtColors }: { takenCarColors: string[]; takenShirtColors: string[] }) => {
          updateCarTaken(takenCarColors);
          updateShirtTaken(takenShirtColors);
        })
        .catch(() => {});
    };

    const syncCount = () => {
      if (playerOptions.mode === 'multi') {
        fetchCount();
        fetchColors();
        if (!poll) poll = setInterval(() => { fetchCount(); fetchColors(); }, 3000);
      } else {
        if (poll) { clearInterval(poll); poll = null; }
        countEl.style.display = 'none';
        updateCarTaken([]);
        updateShirtTaken([]);
      }
    };

    // Play — request pointer lock within the user-gesture click, then start game
    playButton.addEventListener('click', () => {
      if (!assetsReady || !worldReady) return;
      if (poll) clearInterval(poll);
      unsubscribeAssets();
      playerOptions.nickname = nickInput.value.trim() || 'Player';
      root.remove();
      style.remove();
      document.body.requestPointerLock?.();
      resolve();
    });
  });
}
