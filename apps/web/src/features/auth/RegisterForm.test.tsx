import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
  Link: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));

import { RegisterForm } from './RegisterForm';

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  function renderForm(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <RegisterForm />
      </QueryClientProvider>,
    );
  }

  it('renders all 6 fields including the slug helper text', () => {
    renderForm();
    expect(screen.getByLabelText('Nume firmă')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug tenant')).toBeInTheDocument();
    expect(screen.getByLabelText('Numele tău')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Parolă')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmă parola')).toBeInTheDocument();
    expect(
      screen.getByText(/Doar litere mici, cifre și liniuțe/i),
    ).toBeInTheDocument();
  });

  it('rejects an invalid slug (uppercase letters fail the regex)', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RegisterForm />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nume firmă'), 'Acme SRL');
    await user.type(screen.getByLabelText('Slug tenant'), 'BadSlug');
    await user.type(screen.getByLabelText('Numele tău'), 'Andrei');
    await user.type(screen.getByLabelText('Email'), 'a@x.ro');
    await user.type(screen.getByLabelText('Parolă'), 'longenough');
    await user.type(screen.getByLabelText('Confirmă parola'), 'longenough');
    await user.click(screen.getByRole('button', { name: /Creează cont/i }));
    // The helper text and the error both contain the same Romanian phrase,
    // so we discriminate by selecting the .text-destructive paragraph the
    // form renders only on validation failure.
    await screen.findByLabelText('Slug tenant'); // wait for re-render
    const errors = container.querySelectorAll('p.text-destructive');
    expect(Array.from(errors).some((p) => /Doar litere mici/i.test(p.textContent ?? '')))
      .toBe(true);
  });

  it('rejects mismatched password confirmation', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nume firmă'), 'Acme SRL');
    await user.type(screen.getByLabelText('Slug tenant'), 'acme-srl');
    await user.type(screen.getByLabelText('Numele tău'), 'Andrei');
    await user.type(screen.getByLabelText('Email'), 'a@x.ro');
    await user.type(screen.getByLabelText('Parolă'), 'parolaUna');
    await user.type(screen.getByLabelText('Confirmă parola'), 'parolaAlta');
    await user.click(screen.getByRole('button', { name: /Creează cont/i }));
    expect(await screen.findByText(/Parolele nu coincid/i)).toBeInTheDocument();
  });

  it('rejects too-short password', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Slug tenant'), 'acme-srl');
    await user.type(screen.getByLabelText('Nume firmă'), 'Acme');
    await user.type(screen.getByLabelText('Numele tău'), 'A');
    await user.type(screen.getByLabelText('Email'), 'a@x.ro');
    await user.type(screen.getByLabelText('Parolă'), 'short');
    await user.type(screen.getByLabelText('Confirmă parola'), 'short');
    await user.click(screen.getByRole('button', { name: /Creează cont/i }));
    expect(await screen.findByText(/Minim 8 caractere/i)).toBeInTheDocument();
  });
});
