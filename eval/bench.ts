// Latency benchmark:  bash eval/run.sh eval/bench.ts
import { engine } from './harness';

const words = `the quick brown fox jumps over lazy dog tomorow recieve becuase definately environment
schedule komfort katastrofi infrastructure authentication th te tom pro recom govern
thier lenght fucntion langauge rili fone foto`.split(/\s+/).filter(Boolean);
const times: number[] = [];
for (let rep = 0; rep < 3; rep++) {
  for (const w of words) {
    for (let i = 1; i <= w.length; i++) {
      const t0 = performance.now();
      engine.query(w.slice(0, i), 'I think the ');
      times.push(performance.now() - t0);
    }
  }
}
times.sort((a, b) => a - b);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
console.log(`queries=${times.length} mean=${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}ms p50=${pct(0.5)} p90=${pct(0.9)} p99=${pct(0.99)} max=${pct(1)}`);
