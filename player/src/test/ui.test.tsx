import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

describe('Button', () => {
  it('renders its label and calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ask</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs', () => {
  const ui = (
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Chat</TabsTrigger>
        <TabsTrigger value="b">Notes</TabsTrigger>
      </TabsList>
      <TabsContent value="a">panel a</TabsContent>
      <TabsContent value="b">panel b</TabsContent>
    </Tabs>
  );

  it('switches panel on click', async () => {
    render(ui);
    expect(screen.getByText('panel a')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('panel b')).toBeVisible();
    expect(screen.queryByText('panel a')).toBeNull();
  });

  it('switches panel on ArrowRight', async () => {
    render(ui);
    screen.getByRole('tab', { name: 'Chat' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('panel b')).toBeVisible();
  });
});
