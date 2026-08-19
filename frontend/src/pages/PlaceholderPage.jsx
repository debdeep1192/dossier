import { EmptyState } from '../components/States';

export default function PlaceholderPage({ icon, title, description }) {
  return (
    <div>
      <h1 style={{ marginBottom: 'var(--space-5)' }}>{title}</h1>
      <EmptyState
        icon={icon}
        title="Coming in a later phase"
        description={description}
      />
    </div>
  );
}
