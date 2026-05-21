import type { ScopeSource } from './useScopeSampler';
import { Waveform } from './Waveform';
import { Parade } from './Parade';
import { Vectorscope } from './Vectorscope';
import { Histogram } from './Histogram';

export interface ScopesProps {
  /** Video or canvas element all four scopes monitor. Null = blank scopes. */
  source: ScopeSource;
  /**
   * Layout. `stack` (default) is a single column suited to a ~320px sidebar;
   * `grid` is a 2x2 layout for a larger grading view. `auto` picks `grid`
   * on wide containers and `stack` on narrow ones via CSS.
   */
  layout?: 'stack' | 'grid' | 'auto';
  /** Optional extra classes for the outer panel. */
  className?: string;
}

interface CellProps {
  label: string;
  children: React.ReactNode;
  /** Aspect ratio for the scope cell. */
  aspect: string;
}

function Cell({ label, children, aspect }: CellProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div className="w-full" style={{ aspectRatio: aspect }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Compact panel containing all four broadcast scopes. Responsive: a single
 * scrollable column in narrow containers and a 2x2 grid in wide ones (when
 * `layout` is `auto` or `grid`).
 */
export function Scopes({
  source,
  layout = 'auto',
  className,
}: ScopesProps): JSX.Element {
  const containerClass =
    layout === 'grid'
      ? 'grid grid-cols-2 gap-3'
      : layout === 'stack'
        ? 'flex flex-col gap-3'
        : // auto: stack by default, 2-col grid once the panel is wide enough.
          'grid grid-cols-1 gap-3 [@container(min-width:520px)]:grid-cols-2';

  return (
    <div
      className={`bg-surface-800 rounded-lg p-3 [container-type:inline-size] ${className ?? ''}`}
    >
      <div className={containerClass}>
        <Cell label="Waveform" aspect="16 / 9">
          <Waveform source={source} className="h-full w-full" />
        </Cell>
        <Cell label="RGB Parade" aspect="16 / 9">
          <Parade source={source} className="h-full w-full" />
        </Cell>
        <Cell label="Vectorscope" aspect="1 / 1">
          <Vectorscope source={source} className="h-full w-full" />
        </Cell>
        <Cell label="RGB Histogram" aspect="16 / 9">
          <Histogram source={source} className="h-full w-full" />
        </Cell>
      </div>
    </div>
  );
}

export default Scopes;
