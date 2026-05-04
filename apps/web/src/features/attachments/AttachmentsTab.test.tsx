import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentsTab } from './AttachmentsTab';
import { attachmentsApi } from './api';
import type { Attachment } from '@/lib/types';

vi.mock('./api', () => ({
  attachmentsApi: {
    list: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
  },
  uploadAttachment: vi.fn(),
}));

const attachment: Attachment = {
  id: 'att-1',
  tenantId: 'tenant-1',
  subjectType: 'COMPANY',
  subjectId: 'company-1',
  fileName: 'contract.txt',
  mimeType: 'text/plain',
  size: 12,
  storageKey: 'tenant-1/company-1/contract.txt',
  createdAt: '2026-05-04T08:00:00.000Z',
};

describe('AttachmentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(attachmentsApi.list).mockResolvedValue([attachment]);
  });

  function renderTab(): void {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AttachmentsTab subjectType="COMPANY" subjectId="company-1" />
      </QueryClientProvider>,
    );
  }

  it('opens the presigned downloadUrl returned by the API', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(attachmentsApi.download).mockResolvedValue({
      downloadUrl: 'http://localhost/amass-files/contract.txt',
      expiresIn: 900,
      fileName: 'contract.txt',
      mimeType: 'text/plain',
    });

    renderTab();

    await screen.findByText('contract.txt');
    await userEvent.click(screen.getByRole('button', { name: /descarcă/i }));

    expect(open).toHaveBeenCalledWith(
      'http://localhost/amass-files/contract.txt',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
