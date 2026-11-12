import { t } from '../i18n';
import { loadProgress } from '../meta/progress';
import { registerPlayer, type PlayerRecord } from '../meta/player';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RegisterScreen {
  private readonly root: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly airline: HTMLInputElement;
  private readonly email: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly onDone: (player: PlayerRecord) => void;

  constructor(root: HTMLElement, onDone: (player: PlayerRecord) => void) {
    this.root = root;
    this.onDone = onDone;
    this.form = root.querySelector('form')!;
    this.airline = root.querySelector('[name="airline"]')!;
    this.email = root.querySelector('[name="email"]')!;
    this.error = root.querySelector('[data-register="error"]')!;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  show(): void {
    this.root.classList.remove('is-hidden');
    this.error.textContent = '';
    requestAnimationFrame(() => this.airline.focus());
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  private submit(): void {
    const airline = this.airline.value.trim();
    const email = this.email.value.trim();
    if (airline.length < 2) {
      this.error.textContent = t('register.error.short');
      this.airline.focus();
      return;
    }
    if (airline.length > 40) {
      this.error.textContent = t('register.error.long');
      this.airline.focus();
      return;
    }
    if (!EMAIL.test(email)) {
      this.error.textContent = t('register.error.email');
      this.email.focus();
      return;
    }
    const p = loadProgress();
    const player = registerPlayer(airline, email, {
      flights: p.successfulFlights,
      crashes: p.crashes,
      losses: p.deaths,
      cash: p.credits,
    });
    this.hide();
    this.onDone(player);
  }
}
