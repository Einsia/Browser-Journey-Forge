import { forwardRef } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';

export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return clsx(values);
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = 'secondary',
      size = 'md',
      type = 'button',
      ...props
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'ui-button',
          `ui-button-${variant}`,
          `ui-button-${size}`,
          className
        )}
        {...props}
      />
    );
  }
);

export type IconButtonProps = ButtonProps & {
  'aria-label': string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, variant = 'ghost', size = 'sm', ...props },
    ref
  ) {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn('ui-icon-button', className)}
        {...props}
      />
    );
  }
);

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn('ui-dialog-content', className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogTitle = AlertDialogPrimitive.Title;
export const AlertDialogDescription = AlertDialogPrimitive.Description;

export const AlertDialogContent = forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(function AlertDialogContent({ className, children, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="ui-dialog-overlay" />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn('ui-dialog-content', className)}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
});

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuSeparator = DropdownMenuPrimitive.Separator;

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('ui-dropdown-content', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn('ui-dropdown-item', className)}
      {...props}
    />
  );
});

export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn('ui-switch', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  );
});

export function SwitchField(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn('ui-switch-field', props.disabled && 'disabled')}>
      <Switch
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
      />
      <span>
        <strong>{props.label}</strong>
        {props.note ? <em>{props.note}</em> : null}
      </span>
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('ui-input', className)} {...props} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn('ui-input ui-textarea', className)}
      {...props}
    />
  );
});

export function Field(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn('ui-field', props.className)} />;
}

export function FieldLabel(props: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={cn('ui-field-label', props.className)} />;
}

export function FieldDescription(props: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={cn('ui-field-description', props.className)} />
  );
}

export function EmptyState(props: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={cn('ui-empty', props.className)} />;
}

export function Card(props: React.HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cn('ui-card', props.className)} />;
}

export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('ui-card-header', props.className)} />;
}

export function CardContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('ui-card-content', props.className)} />;
}

export function Badge(
  props: React.HTMLAttributes<HTMLSpanElement> & {
    tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  }
) {
  const { tone = 'neutral', ...rest } = props;
  return (
    <span
      {...rest}
      className={cn('ui-badge', `ui-badge-${tone}`, props.className)}
    />
  );
}

export function Alert(
  props: React.HTMLAttributes<HTMLDivElement> & {
    tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  }
) {
  const { tone = 'neutral', ...rest } = props;
  return (
    <div
      {...rest}
      className={cn('ui-alert', `ui-alert-${tone}`, props.className)}
    />
  );
}

export function StatusDetail(props: {
  tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  label: string;
  detail: string;
}) {
  const { tone = 'neutral' } = props;
  return (
    <div className={cn('ui-status-detail', `ui-status-detail-${tone}`)}>
      <strong>{props.label}</strong>
      <span>{props.detail}</span>
    </div>
  );
}

export function Table(props: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table {...props} className={cn('ui-table', props.className)} />;
}

export function TableWrap(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('ui-table-wrap', props.className)} />;
}

export function TableHeader(
  props: React.HTMLAttributes<HTMLTableSectionElement>
) {
  return (
    <thead {...props} className={cn('ui-table-header', props.className)} />
  );
}

export function TableBody(
  props: React.HTMLAttributes<HTMLTableSectionElement>
) {
  return <tbody {...props} className={cn('ui-table-body', props.className)} />;
}

export function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} className={cn('ui-table-row', props.className)} />;
}

export function TableHead(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} className={cn('ui-table-head', props.className)} />;
}

export function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn('ui-table-cell', props.className)} />;
}

export function RadioCard(
  props: React.LabelHTMLAttributes<HTMLLabelElement> & { selected?: boolean }
) {
  const { selected = false, className, ...rest } = props;
  return (
    <label
      {...rest}
      className={cn('ui-radio-card', selected && 'selected', className)}
    />
  );
}

export const Tabs = TabsPrimitive.Root;
export const TabsList = TabsPrimitive.List;
export const TabsTrigger = TabsPrimitive.Trigger;
export const TabsContent = TabsPrimitive.Content;

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('ui-tooltip-content', className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
