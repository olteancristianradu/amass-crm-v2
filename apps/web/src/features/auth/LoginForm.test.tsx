import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

// Mock the router module so <LoginForm> can call useRouter() without a
// mounted <RouterProvider>. The smoke test only needs the form, not nav.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { LoginForm } from './LoginForm';

/**
 * Smoke test: LoginForm rejects empty inputs (client-side Zod) before even
 * hitting the API. We don't assert the submit API call here because that's
 * covered by the BE e2e suite; what we want to pin is "the form renders,
 * the Zod resolver wires up, and the UI reacts to validation".
 */
describe('LoginForm', () => {
  beforeEach(() => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), { status: 401 }),
    );
  });

  function renderForm(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <LoginForm />
      </QueryClientProvider>,
    );
  }

  it('renders all fields', () => {
    renderForm();
    expect(screen.getByLabelText('Tenant')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Parolă')).toBeInTheDocument();
  });

  it('shows validation errors when submitting empty', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Conectare/i }));
    expect(await screen.findByText(/cel puțin 2/i)).toBeInTheDocument();
    expect(await screen.findByText(/email invalid/i)).toBeInTheDocument();
  });
});
