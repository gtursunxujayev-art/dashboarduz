import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FunnelCrmBanner, FunnelTable, LostRevenueTable } from '@/components/dashboard/funnel-tables';

const rows = [
  { userId: 'a', name: 'Sitora', assignedLeads: 10, ishlanganLeads: 6, taklifLeads: 3, calls: 40, sales: 2, avgCheck: 1000, plan: 5 },
  { userId: 'b', name: 'Madina', assignedLeads: null, ishlanganLeads: null, taklifLeads: null, calls: 7, sales: 1, avgCheck: 500, plan: 0 },
];
const totals = { assignedLeads: 10, ishlanganLeads: 6, taklifLeads: 3, calls: 47, sales: 3, avgCheck: 833, plan: 5 };

describe('FunnelTable', () => {
  it('shows totals and dashes for unknown lead counts', () => {
    render(<FunnelTable rows={rows} totals={totals} canEditPlans={false} showMoney />);
    const totalsRow = screen.getByTestId('funnel-totals');
    expect(within(totalsRow).getByText('Jami')).toBeInTheDocument();
    expect(within(totalsRow).getByText('47')).toBeInTheDocument();
    const madinaRow = screen.getByText('Madina').closest('tr') as HTMLElement;
    // 3 lead columns + empty plan
    expect(within(madinaRow).getAllByText('—')).toHaveLength(4);
    expect(screen.queryByLabelText('Reja')).toBeNull();
  });

  it('lets plan editors change a plan', () => {
    const onPlanChange = jest.fn();
    render(<FunnelTable rows={rows} totals={totals} canEditPlans showMoney onPlanChange={onPlanChange} />);
    const [firstInput] = screen.getAllByLabelText('Reja');
    fireEvent.change(firstInput, { target: { value: '8' } });
    fireEvent.blur(firstInput);
    expect(onPlanChange).toHaveBeenCalledWith('a', 8);
  });

  it('hides the average check when money is hidden', () => {
    render(<FunnelTable rows={rows} totals={totals} canEditPlans={false} showMoney={false} />);
    expect(screen.queryByText("O'rtacha chek")).toBeNull();
  });
});

describe('LostRevenueTable', () => {
  it('names the biggest hole or shows a dash', () => {
    render(
      <LostRevenueTable
        rows={[
          { userId: 'a', name: 'Sitora', aktivlik: 100, taklif: 50, yopish: 0, chek: 0, mainHole: 'aktivlik', lostRevenue: 100 },
          { userId: 'b', name: 'Madina', aktivlik: 0, taklif: 0, yopish: 0, chek: 0, mainHole: null, lostRevenue: 0 },
        ]}
        totals={{ aktivlik: 100, taklif: 50, yopish: 0, chek: 0, mainHole: null, lostRevenue: 100 }}
      />,
    );
    const sitoraRow = screen.getByText('Sitora').closest('tr') as HTMLElement;
    expect(within(sitoraRow).getByText('Aktivlik')).toBeInTheDocument();
    const madinaRow = screen.getByText('Madina').closest('tr') as HTMLElement;
    expect(within(madinaRow).getByText('—')).toBeInTheDocument();
  });
});

describe('FunnelCrmBanner', () => {
  it('shows the reason and retries', () => {
    const onRetry = jest.fn();
    render(<FunnelCrmBanner reason="timeout" unmappedNames={['Saida']} onRetry={onRetry} isRetrying={false} />);
    expect(screen.getByText('AmoCRM javob berish vaqti tugadi.')).toBeInTheDocument();
    expect(screen.getByText(/Saida/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Qayta urinish' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('explains a call-notes failure', () => {
    render(<FunnelCrmBanner reason="calls_fetch_failed" unmappedNames={[]} onRetry={jest.fn()} isRetrying={false} />);
    expect(screen.getByText(/Ishlangan lid hisoblanmadi/)).toBeInTheDocument();
  });

  it('renders nothing when everything loaded', () => {
    const { container } = render(<FunnelCrmBanner reason={null} unmappedNames={[]} onRetry={jest.fn()} isRetrying={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
