'use client';

import { AddCustomerModal } from './_components/add-customer-modal';
import { CustomerCoursesModal } from './_components/customer-courses-modal';
import { CustomerDetailsModal } from './_components/customer-details-modal';
import { CustomerIdentityModal } from './_components/customer-identity-modal';
import { CustomersFilters } from './_components/customers-filters';
import { CustomersTable } from './_components/customers-table';
import { useCustomersPage } from './_components/use-customers-page';

export default function CustomersPage() {
  const vm = useCustomersPage();

  return (
    <div className="space-y-6">
      <CustomersFilters vm={vm} />

      <CustomersTable vm={vm} />

      <AddCustomerModal vm={vm} />

      <CustomerIdentityModal vm={vm} />

      <CustomerCoursesModal vm={vm} />

      <CustomerDetailsModal vm={vm} />
    </div>
  );
}
