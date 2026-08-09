export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="search-bar"
      type="search"
      autoFocus
      placeholder="Search for a student by name…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
