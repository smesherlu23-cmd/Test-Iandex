/**
 * Балансный прогон (ТЗ §11, Этап 5): десять тысяч автобоёв и отчёт по каждой
 * карте. Запускается в CI: `npm run balance`.
 *
 * Критерий: ни одна карта не должна встречаться более чем в 70% успешных
 * билдов, иначе она обязательна и выбор карт превращается в декорацию.
 */
import { DOMINANCE_LIMIT, SPREAD_LIMIT, runBalance } from './balanceRun';

const BATTLES = Number(process.env.BALANCE_BATTLES ?? 10_000);

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const started = Date.now();
const report = runBalance(BATTLES);

console.log(
  `Боёв: ${report.battles}, успешных (герой убит): ${report.wins} (${pct(report.wins / report.battles)})`,
);
console.log(`Время: ${((Date.now() - started) / 1000).toFixed(1)} с\n`);
console.log('карта                  билдов   винрейт   доля успешных   урон/бой');

for (const c of report.cards) {
  const winrate = c.builds > 0 ? c.wins / c.builds : 0;
  const share = report.wins > 0 ? c.wins / report.wins : 0;
  console.log(
    `${c.name.padEnd(22)} ${String(c.builds).padStart(6)}   ${pct(winrate).padStart(7)}   ` +
      `${pct(share).padStart(13)}   ${(c.damage / Math.max(1, c.builds)).toFixed(1).padStart(8)}`,
  );
}

console.log(`\nРазброс винрейта карт: ${pct(report.spread)} (порог ${pct(SPREAD_LIMIT)})`);
console.log('\nволна  боёв   винрейт босса');
for (const w of report.perWave) {
  console.log(`${String(w.wave).padStart(5)} ${String(w.battles).padStart(6)}   ${pct(w.wins / w.battles)}`);
}

const problems: string[] = [];
if (report.dominant) {
  problems.push(
    `«${report.dominant.name}» встречается в ${pct(report.dominance)} успешных билдов ` +
      `при пороге ${pct(DOMINANCE_LIMIT)}`,
  );
}
if (report.spread > SPREAD_LIMIT) {
  problems.push(`разброс винрейта ${pct(report.spread)} превышает ${pct(SPREAD_LIMIT)}`);
}

if (problems.length > 0) {
  console.error(`\nБаланс не сошёлся:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('\nБаланс сошёлся: доминирующих карт нет.');
}
