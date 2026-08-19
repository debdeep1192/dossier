import { useState } from 'react';
import { Tag } from './Badge';
import './TagInput.css';

export default function TagInput({ tags, onAdd, onRemove }) {
  const [value, setValue] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const label = value.trim();
    if (!label) return;
    setValue('');
    await onAdd(label);
  }

  return (
    <div className="tag-input">
      <div className="tag-input__list">
        {tags.map(tag => (
          <Tag key={tag.id} label={tag.label} onRemove={() => onRemove(tag.id)} />
        ))}
      </div>
      <form onSubmit={handleSubmit} className="tag-input__form">
        <input
          className="tag-input__field"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Add a tag and press enter…"
        />
      </form>
    </div>
  );
}
