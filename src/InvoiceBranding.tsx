import type { Settings } from './domain';

export function InvoiceBranding({ settings }: { settings: Settings }) {
  return (
    <section
      className="invoice-branding"
      aria-label="Invoice business details"
      style={{ borderBottomColor: settings.brand_color }}
    >
      {settings.logo_url && <img src={settings.logo_url} alt={`${settings.business_name} logo`} />}
      <div>
        <h3 style={{ color: settings.brand_color }}>{settings.business_name}</h3>
        {settings.address && <p className="business-address">{settings.address}</p>}
        {(settings.email || settings.phone) && (
          <p className="business-contact">
            {[settings.email, settings.phone].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </section>
  );
}
