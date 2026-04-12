import { Game, GameSystem } from '../core/Game';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  interact: boolean;      // E key — held state
  interactPressed: boolean; // E key — single-frame pulse
  mouseDX: number;
  mouseDY: number;
  pointerLocked: boolean;
}

/**
 * Handles keyboard, mouse, and touch input.
 * Manages pointer lock on desktop, virtual joystick on mobile.
 */
export class InputSystem implements GameSystem {
  readonly name = 'input';
  readonly state: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    interact: false,
    interactPressed: false,
    mouseDX: 0,
    mouseDY: 0,
    pointerLocked: false,
  };

  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLElement;

  // Touch controls
  private touchMoveId: number | null = null;
  private touchLookId: number | null = null;
  private touchMoveStart = { x: 0, y: 0 };
  private touchLookPrev = { x: 0, y: 0 };
  readonly isMobile = 'ontouchstart' in window;

  // Mobile UI elements
  private interactBtn: HTMLButtonElement | null = null;
  private joystickBase: HTMLDivElement | null = null;
  private joystickThumb: HTMLDivElement | null = null;
  private lookIndicator: HTMLDivElement | null = null;

  init(game: Game): void {
    this.canvas = game.renderer.domElement;
    this.overlay = document.getElementById('overlay')!;

    // Keyboard
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Mouse
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    // Click to lock pointer (desktop) or dismiss overlay (mobile)
    this.overlay.addEventListener('click', () => {
      if (this.isMobile) {
        this.overlay.classList.add('hidden');
        this.state.pointerLocked = true; // treat as "active" on mobile
      } else {
        this.canvas.requestPointerLock();
      }
    });

    // Touch
    if (this.isMobile) {
      this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
      this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
      this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
      this.buildMobileButtons();
    }
  }

  /** Call at end of each frame to reset per-frame deltas. */
  resetDeltas(): void {
    this.state.mouseDX = 0;
    this.state.mouseDY = 0;
    this.state.interactPressed = false;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.interactBtn?.remove();
    this.joystickBase?.remove();
    this.joystickThumb?.remove();
    this.lookIndicator?.remove();
  }

  // --- Keyboard ---

  private onKeyDown = (e: KeyboardEvent): void => {
    this.mapKey(e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.mapKey(e.code, false);
  };

  private mapKey(code: string, down: boolean): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.state.forward = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.state.backward = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.state.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.state.right = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.state.sprint = down;
        break;
      case 'KeyE':
        this.state.interact = down;
        if (down) this.state.interactPressed = true;
        break;
    }
  }

  // --- Mouse ---

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.state.pointerLocked) return;
    this.state.mouseDX += e.movementX;
    this.state.mouseDY += e.movementY;
  };

  private onPointerLockChange = (): void => {
    this.state.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.state.pointerLocked) {
      this.overlay.classList.add('hidden');
    } else {
      this.overlay.classList.remove('hidden');
      // Reset movement keys on unlock
      this.state.forward = this.state.backward = this.state.left = this.state.right = false;
    }
  };

  // --- Touch ---

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    const w = window.innerWidth;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < w / 2 && this.touchMoveId === null) {
        // Left half: movement
        this.touchMoveId = t.identifier;
        this.touchMoveStart = { x: t.clientX, y: t.clientY };
        this.showJoystick(t.clientX, t.clientY);
      } else if (t.clientX >= w / 2 && this.touchLookId === null) {
        // Right half: look
        this.touchLookId = t.identifier;
        this.touchLookPrev = { x: t.clientX, y: t.clientY };
        this.showLookIndicator(t.clientX, t.clientY);
      }
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (t.identifier === this.touchMoveId) {
        const dx = t.clientX - this.touchMoveStart.x;
        const dy = t.clientY - this.touchMoveStart.y;
        const deadzone = 15;
        const maxDist = 50;
        this.state.forward = dy < -deadzone;
        this.state.backward = dy > deadzone;
        this.state.left = dx < -deadzone;
        this.state.right = dx > deadzone;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.state.sprint = dist > maxDist;
        this.updateJoystickThumb(dx, dy, maxDist);
      }

      if (t.identifier === this.touchLookId) {
        this.state.mouseDX += (t.clientX - this.touchLookPrev.x) * 2;
        this.state.mouseDY += (t.clientY - this.touchLookPrev.y) * 2;
        this.touchLookPrev = { x: t.clientX, y: t.clientY };
        this.moveLookIndicator(t.clientX, t.clientY);
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.touchMoveId) {
        this.touchMoveId = null;
        this.state.forward = this.state.backward = this.state.left = this.state.right = this.state.sprint = false;
        this.hideJoystick();
      }
      if (t.identifier === this.touchLookId) {
        this.touchLookId = null;
        this.hideLookIndicator();
      }
    }
  };

  // --- Mobile UI ---

  private buildMobileButtons(): void {
    const btnStyle: Partial<CSSStyleDeclaration> = {
      position: 'fixed',
      zIndex: '100',
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.4)',
      background: 'rgba(0,0,0,0.35)',
      color: '#fff',
      fontSize: '13px',
      fontFamily: 'sans-serif',
      fontWeight: '600',
      letterSpacing: '0.03em',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'none',
    };

    // Interact button — right side, above center
    this.interactBtn = document.createElement('button');
    Object.assign(this.interactBtn.style, btnStyle, {
      right: '20px',
      bottom: '100px',
    } as Partial<CSSStyleDeclaration>);
    this.interactBtn.textContent = 'E';
    this.interactBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.state.interact = true;
      this.state.interactPressed = true;
      this.interactBtn!.style.background = 'rgba(255,255,255,0.3)';
    }, { passive: false });
    this.interactBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.state.interact = false;
      this.interactBtn!.style.background = 'rgba(0,0,0,0.35)';
    }, { passive: false });
    document.body.appendChild(this.interactBtn);

    // Joystick base (appears on touch)
    this.joystickBase = document.createElement('div');
    Object.assign(this.joystickBase.style, {
      position: 'fixed',
      width: '120px',
      height: '120px',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.25)',
      background: 'rgba(255,255,255,0.06)',
      pointerEvents: 'none',
      zIndex: '90',
      display: 'none',
      transform: 'translate(-50%, -50%)',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.joystickBase);

    // Joystick thumb
    this.joystickThumb = document.createElement('div');
    Object.assign(this.joystickThumb.style, {
      position: 'fixed',
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.3)',
      border: '2px solid rgba(255,255,255,0.5)',
      pointerEvents: 'none',
      zIndex: '91',
      display: 'none',
      transform: 'translate(-50%, -50%)',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.joystickThumb);

    // Look indicator (small dot where the look touch is)
    this.lookIndicator = document.createElement('div');
    Object.assign(this.lookIndicator.style, {
      position: 'fixed',
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.15)',
      border: '1px solid rgba(255,255,255,0.3)',
      pointerEvents: 'none',
      zIndex: '90',
      display: 'none',
      transform: 'translate(-50%, -50%)',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.lookIndicator);
  }

  // --- Joystick visuals ---

  private showJoystick(cx: number, cy: number): void {
    if (!this.joystickBase || !this.joystickThumb) return;
    this.joystickBase.style.left = `${cx}px`;
    this.joystickBase.style.top = `${cy}px`;
    this.joystickBase.style.display = 'block';
    this.joystickThumb.style.left = `${cx}px`;
    this.joystickThumb.style.top = `${cy}px`;
    this.joystickThumb.style.display = 'block';
  }

  private updateJoystickThumb(dx: number, dy: number, maxDist: number): void {
    if (!this.joystickThumb) return;
    // Clamp thumb to base radius
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    const thumbX = this.touchMoveStart.x + Math.cos(angle) * clampedDist;
    const thumbY = this.touchMoveStart.y + Math.sin(angle) * clampedDist;
    this.joystickThumb.style.left = `${thumbX}px`;
    this.joystickThumb.style.top = `${thumbY}px`;
  }

  private hideJoystick(): void {
    if (this.joystickBase) this.joystickBase.style.display = 'none';
    if (this.joystickThumb) this.joystickThumb.style.display = 'none';
  }

  // --- Look indicator visuals ---

  private showLookIndicator(cx: number, cy: number): void {
    if (!this.lookIndicator) return;
    this.lookIndicator.style.left = `${cx}px`;
    this.lookIndicator.style.top = `${cy}px`;
    this.lookIndicator.style.display = 'block';
  }

  private moveLookIndicator(cx: number, cy: number): void {
    if (!this.lookIndicator) return;
    this.lookIndicator.style.left = `${cx}px`;
    this.lookIndicator.style.top = `${cy}px`;
  }

  private hideLookIndicator(): void {
    if (this.lookIndicator) this.lookIndicator.style.display = 'none';
  }
}
