import './Button.css';

export default function Button({
  children,
  variant = 'primary', // primary | secondary | ghost | danger
  size = 'md', // sm | md | lg
  icon,
  iconPosition = 'left',
  fullWidth = false,
  type = 'button',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth ? 'btn--full' : '',
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {icon && iconPosition === 'left' && <span className="btn__icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
      {icon && iconPosition === 'right' && <span className="btn__icon" aria-hidden="true">{icon}</span>}
    </button>
  );
}
