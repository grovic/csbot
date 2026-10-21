export function Placeholder({ title, milestone, text }: { title: string; milestone: string; text: string }) {
  return (
    <div className="placeholder" data-testid="placeholder">
      <div className="kick">{milestone}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      <p><a href="#/live">Back to Live</a></p>
    </div>
  );
}
