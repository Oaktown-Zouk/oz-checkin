import { forwardRef } from "react";

export const SearchBar = forwardRef<HTMLInputElement, { value: string; onChange: (value: string) => void }>(
  function SearchBar({ value, onChange }, ref) {
    return (
      <input
        ref={ref}
        className="search-bar"
        type="search"
        autoFocus
        placeholder="Search for a student by name…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
);
