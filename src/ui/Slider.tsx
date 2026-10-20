import type { ComponentProps, CSSProperties } from 'react';

type Props = Omit<ComponentProps<'input'>, 'type' | 'min' | 'max' | 'value'> & { min: number; max: number; value: number };

export function Slider({ min, max, value, style, ...props }: Props) {
  const progress = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  return <input {...props} type="range" min={min} max={max} value={value} style={{ '--range-progress': `${progress}%`, ...style } as CSSProperties} />;
}
