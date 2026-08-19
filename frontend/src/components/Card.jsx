import './Card.css';

export default function Card({ children, interactive = false, accentColor, padding = 'md', className = '', ...rest }) {
  const classes = [
    'card',
    `card--padding-${padding}`,
    interactive ? 'card--interactive' : '',
    className,
  ].filter(Boolean).join(' ');

  const style = accentColor ? { '--card-accent': accentColor } : undefined;

  return (
    <div className={classes} style={style} {...rest}>
      {accentColor && <span className="card__accent-bar" aria-hidden="true" />}
      {children}
    </div>
  );
}
