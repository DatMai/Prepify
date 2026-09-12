import { initJourneyView, openJourney } from '../journey/journeyView';
import { t } from '../i18n';

export function initJourneyBtn(): void {
  initJourneyView();
  const button = document.getElementById('journeyBtn');
  const label = document.getElementById('journeyBtnLabel');
  if (label) label.textContent = t('topbar.journey');
  button?.setAttribute('title', t('journey.title'));
  button?.addEventListener('click', () => {
    void openJourney();
  });
}
