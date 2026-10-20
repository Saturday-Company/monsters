import { expect, test } from './fixtures.ts';

/*
 * Settings → Modelli (M2.2) on the mock core: what is connected first, the
 * rest behind "Collega un altro modello"; add a key (refused, then verified),
 * connect a local server, choose the models of a monster (saved by itself).
 */

test('providers: add a key, connect Ollama, choose the models of a monster', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const connected = page.getByTestId('models-connected');
  await expect(connected.getByTestId('provider-row-openrouter')).toBeVisible();
  // The services not connected yet wait behind one button.
  await expect(page.getByTestId('providers')).toHaveCount(0);
  await connected.getByRole('button', { name: 'Collega un altro modello' }).click();
  const section = page.getByTestId('providers');
  await expect(
    section.getByRole('heading', { name: 'Con una chiave o sul tuo computer' }),
  ).toBeVisible();

  const anthropic = section.getByTestId('provider-row-anthropic');
  await expect(anthropic).toHaveAttribute('data-configured', 'no');
  await anthropic.getByRole('button', { name: 'Aggiungi la chiave' }).click();
  // A paid provider says so before the key is saved.
  await expect(anthropic.getByTestId('paid-notice')).toContainText('A pagamento');
  const key = anthropic.getByLabel('Chiave di Anthropic');
  await key.fill('sk-ant-wrong-0123456789');
  await anthropic.getByRole('button', { name: 'Verifica e salva' }).click();
  await expect(anthropic.getByRole('alert')).toHaveText('Anthropic non riconosce questa chiave.');
  await key.fill('sk-ant-api03-0123456789abcdef');
  await anthropic.getByRole('button', { name: 'Verifica e salva' }).click();
  await expect(page.getByText('Chiave di Anthropic verificata e salvata.')).toBeVisible();
  // Now it is among what the monsters think with.
  const anthropicOn = connected.getByTestId('provider-row-anthropic');
  await expect(anthropicOn).toHaveAttribute('data-configured', 'yes');
  await expect(anthropicOn.getByText('Chiave attiva.')).toBeVisible();
  await expect(section.getByTestId('provider-row-anthropic')).toHaveCount(0);

  const ollama = section.getByTestId('provider-row-ollama');
  await ollama.getByRole('button', { name: 'Collega' }).click();
  const address = ollama.getByLabel('Indirizzo di Ollama');
  await address.fill('http://127.0.0.1:9999');
  await ollama.getByRole('button', { name: 'Collega' }).click();
  await expect(ollama.getByRole('alert')).toContainText('è acceso?');
  await address.fill('http://127.0.0.1:11434');
  await ollama.getByRole('button', { name: 'Collega' }).click();
  await expect(connected.getByTestId('provider-row-ollama')).toHaveAttribute(
    'data-configured',
    'yes',
  );

  // Rhea: Anthropic first, the free router as fallback.
  // Everybody shares one model at first (D-066): one chain per monster on request.
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByRole('button', { name: 'Aggiungi un’alternativa' }).click();
  await rhea.getByLabel('Servizio 1 di Rhea', { exact: true }).selectOption('anthropic');
  await expect(rhea.getByLabel('Modello 1 di Rhea', { exact: true })).toHaveValue(
    'claude-sonnet-test',
  );
  await rhea.getByLabel('Modello 1 di Rhea', { exact: true }).selectOption('claude-haiku-test');
  await rhea.getByLabel('Servizio 2 di Rhea', { exact: true }).selectOption('openrouter');
  await expect(rhea.getByLabel('Modello 2 di Rhea', { exact: true })).toHaveValue(
    'Gratuito, scelto da OpenRouter',
  );
  await expect(rhea.getByTestId('paid-notice')).toBeVisible();
  // No save button: the chain saves itself a moment after the last change.
  await expect(rhea.getByRole('button', { name: /Salva/ })).toHaveCount(0);
  await expect(page.getByText('Modelli di Rhea salvati.')).toBeVisible();
  // What the core has now, read again from it (same mock core: through the app, no reload).
  await page.evaluate(() => (window.location.hash = '#/'));
  await expect(page.getByTestId('agent-chain-rhea')).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  const saved = page.getByTestId('agent-chain-rhea');
  await expect(saved.getByLabel('Modello 1 di Rhea', { exact: true })).toHaveValue(
    'claude-haiku-test',
  );
  await expect(saved.getByLabel('Modello 2 di Rhea', { exact: true })).toHaveValue(
    'Gratuito, scelto da OpenRouter',
  );

  // Removing the key (confirmed in place): Rhea's chain still names Anthropic, not connected.
  const anthropicRow = page.getByTestId('provider-row-anthropic');
  await anthropicRow.getByRole('button', { name: 'Scollega' }).click();
  await anthropicRow.getByRole('button', { name: 'Sì, scollega' }).click();
  await expect(page.getByText('Chiave di Anthropic tolta.')).toBeVisible();
  await expect(
    page.getByTestId('models-connected').getByTestId('provider-row-anthropic'),
  ).toHaveCount(0);
  await expect(saved.getByLabel('Servizio 1 di Rhea', { exact: true })).toContainText(
    'Anthropic (non collegato)',
  );
});

test('OpenRouter: paid models are off by default, shown as not usable until turned on', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page
    .getByTestId('provider-row-openrouter')
    .getByRole('button', { name: 'Cambia', exact: true })
    .click();
  const paid = page.getByTestId('openrouter-paid');
  await expect(paid).toHaveAttribute('data-on', 'no');
  await expect(paid).toContainText('solo i modelli gratuiti');

  // A paid model in a chain: marked as not usable, the chain cannot be saved.
  // Everybody shares one model at first (D-066): one chain per monster on request.
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  const first = rhea.getByLabel('Modello 1 di Rhea', { exact: true });
  await first.fill('google/gemini-2.5-flash-lite');
  // What is typed searches; leaving the field makes it the model (an exact id).
  await first.blur();
  const blocked = rhea.getByTestId('paid-blocked');
  await expect(blocked).toContainText('google/gemini-2.5-flash-lite');
  await expect(blocked).toContainText('OpenRouter ora usa solo i modelli gratuiti');
  await expect(blocked.getByTestId('paid-notice')).toContainText('A pagamento');
  // Not saved while blocked.
  await page.waitForTimeout(1200);
  await expect(page.getByText('Modelli di Rhea salvati.')).toHaveCount(0);

  // Turned on from the chain, after the cost note: the chain saves, the switch follows.
  await blocked.getByRole('button', { name: 'Usa anche modelli a pagamento' }).click();
  await expect(rhea.getByTestId('paid-blocked')).toHaveCount(0);
  await expect(rhea.getByTestId('paid-notice')).toBeVisible();
  await expect(page.getByText('Modelli di Rhea salvati.')).toBeVisible();
  await expect(paid).toHaveAttribute('data-on', 'yes');

  // Off from the switch at once; on again only after confirming the cost note.
  const toggle = paid.getByRole('switch', { name: 'Usa anche modelli a pagamento' });
  await toggle.click();
  await expect(paid).toHaveAttribute('data-on', 'no');
  await toggle.click();
  await expect(paid.getByTestId('paid-notice')).toBeVisible();
  await expect(paid).toHaveAttribute('data-on', 'no');
  await paid.getByRole('button', { name: 'Attiva i modelli a pagamento' }).click();
  await expect(paid).toHaveAttribute('data-on', 'yes');
});
