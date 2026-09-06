/**
 * SmartNav360 — SearchBar
 * Reusable search input with debounce.
 */

import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import './SearchBar.css';

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  size = 'middle',
  allowClear = true,
  className = '',
}) {
  return (
    <Input
      className={`search-bar ${className}`}
      prefix={<SearchOutlined className="search-bar__icon" />}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      allowClear={allowClear}
      size={size}
    />
  );
}
