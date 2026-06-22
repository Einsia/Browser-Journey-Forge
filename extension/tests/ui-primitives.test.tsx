import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldLabel,
  IconButton,
  Input,
} from '@/ui/primitives';

describe('ui primitives', () => {
  it('renders dropdown menu content in a portal and dismisses on outside click', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();

    render(
      <div data-testid="table-cell">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="Recording actions">Actions</IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onExport}>Export JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'Recording actions' }));

    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('table-cell')).not.toContainElement(menu);

    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: 'Recording actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export JSON' }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('renders accessible dialogs that close through the provided close control', async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>View Identity</Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Generated Identity</DialogTitle>
          <p>research-user@example.test</p>
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    );

    await user.click(screen.getByRole('button', { name: 'View Identity' }));

    expect(
      screen.getByRole('dialog', { name: 'Generated Identity' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Generated Identity' })
      ).not.toBeInTheDocument()
    );
  });

  it('provides shared form and content primitives for redesigned surfaces', () => {
    render(
      <Card>
        <CardHeader>
          <strong>Settings</strong>
          <Badge tone="success">Saved</Badge>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel>Endpoint URL</FieldLabel>
            <Input aria-label="Endpoint URL" />
          </Field>
          <EmptyState>No local recordings yet.</EmptyState>
        </CardContent>
      </Card>
    );

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toHaveClass('ui-badge-success');
    expect(screen.getByLabelText('Endpoint URL')).toHaveClass('ui-input');
    expect(screen.getByText('No local recordings yet.')).toHaveClass(
      'ui-empty'
    );
  });
});
