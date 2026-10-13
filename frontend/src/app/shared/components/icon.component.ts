import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

/** Set de iconos SVG (trazo) usados en la interfaz. */
const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  receipt:
    '<path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-3-2V4a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  wallet:
    '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  box: '<path d="M12 3 3.5 7.2v9.6L12 21l8.5-4.2V7.2L12 3Z"/><path d="M3.6 7.3 12 11.4l8.4-4.1M12 11.5V21"/>',
  tag: '<path d="M12.6 3.6H20v7.4l-8.7 8.7a1.6 1.6 0 0 1-2.3 0l-5.1-5.1a1.6 1.6 0 0 1 0-2.3l8.7-8.7Z"/><circle cx="16.6" cy="7.4" r="1.3"/>',
  folder:
    '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18v-11.5Z"/>',
  truck:
    '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5V16H3V7.5Z"/><path d="M15 10h3.2l2.8 3.2V16h-6"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  users:
    '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/><path d="M16.5 6.2a3 3 0 0 1 0 5.8M17 14.6c2.1.5 3.6 2.3 3.6 4.6"/>',
  chart: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="6" rx="1"/><rect x="11" y="7" width="3" height="10" rx="1"/><rect x="16" y="13" width="3" height="4" rx="1"/>',
  'user-cog':
    '<circle cx="10" cy="8" r="3.2"/><path d="M4 19.5c0-3 2.7-5.2 6-5.2s6 2.2 6 5.2"/><circle cx="18" cy="15" r="2"/><path d="M18 11.6v1.2M18 17.2v1.2M14.9 13.2l1 .8M20.1 16l1 .8M14.9 16.8l1-.8M20.1 14l1-.8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 13 4.5 4.5L19 7"/>',
  alert: '<path d="M12 4.5 21 20H3L12 4.5Z"/><path d="M12 10v5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8.2h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'chevron-left': '<path d="m14 6-6 6 6 6"/>',
  'chevron-right': '<path d="m10 6 6 6-6 6"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4.5V10h-5.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3.5V6M16 3.5V6"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13A1.5 1.5 0 0 1 18.5 20H15"/><path d="M11 8l-4 4 4 4M7 12h9"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5h.01M17.5 14.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  'trend-up': '<path d="M4 17 10 11l3.5 3.5L20 8"/><path d="M15 8h5v5"/>',
  'trend-down': '<path d="M4 8l6 6 3.5-3.5L20 17"/><path d="M15 17h5v-5"/>',
  filter: '<path d="M4 6h16l-6 7v5.5L10 20v-7L4 6Z"/>',
  building:
    '<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M9 7.5h.01M15 7.5h.01M9 11h.01M15 11h.01M9 14.5h.01M15 14.5h.01M10.5 20.5v-3h3v3"/>',
  keypad:
    '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8"/>',
  settings:
    '<path d="M4 7h9M18.5 7H20M4 12h3M12.5 12H20M4 17h6M15.5 17H20"/><circle cx="15.5" cy="7" r="2.2"/><circle cx="9.5" cy="12" r="2.2"/><circle cx="12.5" cy="17" r="2.2"/>',
  exchange:
    '<path d="M4 8.5h13.5"/><path d="M14 5l3.5 3.5L14 12"/><path d="M20 15.5H6.5"/><path d="M10 12l-3.5 3.5L10 19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.3M12 19.2v2.3M4.1 4.1l1.6 1.6M18.3 18.3l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.1 19.9l1.6-1.6M18.3 5.7l1.6-1.6"/>',
  moon: '<path d="M20.2 13.6A8.6 8.6 0 0 1 10.4 3.8 8.5 8.5 0 1 0 20.2 13.6Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="M4 4l16 16"/><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-3.1 3.9"/><path d="M6.4 7.7A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.8 9.8 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.class]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      [innerHTML]="path"
    ></svg>
  `,
  styles: [':host { display: inline-flex; align-items: center; }'],
})
export class IconComponent {
  private readonly sanitizer = inject(DomSanitizer);

  @Input() name = 'grid';
  @Input() size = 'h-5 w-5';

  /** El trazado SVG es contenido estatico definido en este archivo. */
  get path(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name] ?? ICONS['grid']);
  }
}
