import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));

import { ResetPasswordForm } from './ResetPasswordForm';

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  });

  function renderForm(token: string): void {
    render(
      <QueryClientProvider client={queryClient}>
        <ResetPasswordForm token={token} />
      </QueryClientProvider>,
    );
  }

  it('renders a "missing token" panel when token is empty', () => {
    renderForm('');
    expect(screen.getByText('Token lipsă')).toBeInTheDocument();
    expect(screen.queryByLabelText('Parolă nouă')).not.toBeInTheDocument();
  });

  it('renders the form when token is present', () => {
    renderForm('a-valid-looking-token');
    expect(screen.getByLabelText('Parolă nouă')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmă parola')).toBeInTheDocument();
  });

  it('rejects mismatched passwords client-side', async () => {
    renderForm('TOKEN');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Parolă nouă'), 'longenough');
    await user.type(screen.getByLabelText('Confirmă parola'), 'longenough2');
    await user.click(screen.getByRole('button', { name: /Schimbă parola/i }));
    expect(await screen.findByText(/Parolele nu coincid/i)).toBeInTheDocument();
  });

  it('rejects short password client-side', async () => {
    renderForm('TOKEN');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Parolă nouă'), 'short');
    await user.type(screen.getByLabelText('Confirmă parola'), 'short');
    await user.click(screen.getByRole('button', { name: /Schimbă parola/i }));
    expect(await screen.findByText(/Minim 8 caractere/i)).toBeInTheDocument();
  });
});
