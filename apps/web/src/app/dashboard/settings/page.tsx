'use client';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-5 border-b border-gray-100">
          <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Workspace and account settings will be managed here.</p>
        </div>
        <div className="p-6">
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
            Settings page is available and ready for MVP extensions.
          </div>
        </div>
      </div>
    </div>
  );
}
