import type { NightDigest } from '../digest/types.js';

// One row per job, already sorted by job by readNight. Marked cells use the layout's .warn,
// the same way the status board marks a missing beat; .mute for absent data and side notes.
export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>status</th>
              <th>error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? <span class="mute">—</span>}</td>
                <td>{row.runs}</td>
                <td>{row.retries >= 3 ? <span class="warn">{row.retries}</span> : row.retries}</td>
                <td>{row.status === 'fail' ? <span class="warn">{row.status}</span> : row.status}</td>
                <td>{row.error ?? <span class="mute">—</span>}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {digest.badLines > 0 && (
        <p class="mute">
          {digest.badLines} unreadable line{digest.badLines === 1 ? '' : 's'} not shown
        </p>
      )}
    </>
  );
}
