import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

import { ForgotPasswordForm } from './ForgotPasswordForm';

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  });

  function renderForm(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <ForgotPasswordForm />
      </QueryClientProvider>,
    );
  }

  it('renders tenant + email fields', () => {
    renderForm();
    expect(screen.getByLabelText('Tenant')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Trimite link de resetare/i }),
    ).toBeInTheDocument();
  });

  it('shows a neutral confirmation after a successful submit (anti-enumeration)', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Tenant'), 'acme-srl');
    await user.type(screen.getByLabelText('Email'), 'maybe@unknown.com');
    await user.click(screen.getByRole('button', { name: /Trimite link de resetare/i }));
    expect(
      await screen.findByText(/Dacă există un cont cu adresa indicată/i),
    ).toBeInTheDocument();
  });

  it('rejects an invalid email before hitting the API', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Tenant'), 'acme-srl');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Trimite link de resetare/i }));
    expect(await screen.findByText(/Email invalid/i)).toBeInTheDocument();
  });
});
