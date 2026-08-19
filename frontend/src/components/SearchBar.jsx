import './SearchBar.css';

export default function SearchBar({ value, onChange, placeholder = 'Search…', onSubmit }) {
  return (
    <form
      className="search-bar"
      onSubmit={e => { e.preventDefault(); onSubmit?.(value); }}
      role="search"
    >
      <span className="search-bar__icon" aria-hidden="true">⌕</span>
      <input
        className="search-bar__input"
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </form>
  );
}
