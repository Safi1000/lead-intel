import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { authApi } from '../../api/endpoints'
import { useAuthStore } from '../../stores/authStore'
import { Button, Card } from '../../components/ui/primitives'

interface Section { h?: string; p: string[] }
interface Doc { title: string; updated: string; sections: Section[] }

const UPDATED = 'July 12, 2026'

const COPY: Record<'terms' | 'privacy' | 'aup', Doc> = {
  terms: {
    title: 'Terms of Service',
    updated: UPDATED,
    sections: [
      { p: [
        'These Terms of Service ("Terms") govern your access to and use of LeadIntel, a lead-generation and sales-workflow platform operated by TechxServe ("LeadIntel", "we", "us", or "our"). By creating an account, accessing, or using the platform (the "Service"), you agree to these Terms on behalf of yourself and any organization you represent. If you do not agree, do not use the Service.',
      ] },
      { h: '1. The Service', p: [
        'LeadIntel helps businesses discover, qualify, organize, and follow up with prospective business customers ("Leads"). Lead information is compiled from publicly available and licensed sources and is presented as enriched estimates. The Service also provides tools to manage outreach and, where you enable them, to sync Leads to third-party systems such as your CRM.',
      ] },
      { h: '2. Accounts and Eligibility', p: [
        'You must be at least 18 years old and able to form a binding contract to use the Service. You are responsible for the accuracy of your account information, for maintaining the confidentiality of your credentials, and for all activity that occurs under your account. Notify us promptly of any unauthorized use.',
      ] },
      { h: '3. Acceptable Use and Legal Compliance', p: [
        'You are solely responsible for how you use Leads and any communications you send. You agree to comply with all applicable laws and regulations, including those governing telemarketing, electronic messaging, and data protection (for example, the TCPA, CAN-SPAM Act, CASL, GDPR, and CCPA/CPRA). You must honor opt-out and do-not-contact requests, obtain any consent required for your outreach, and not use the Service for harassment, deceptive, or unlawful purposes. See our Acceptable Use Policy, which is incorporated into these Terms.',
      ] },
      { h: '4. Lead Data and Accuracy', p: [
        'Lead data is provided "as is" and as estimates derived from automated sourcing and enrichment. We do not warrant that any Lead information is accurate, complete, current, or suitable for a particular purpose, and we are not responsible for outcomes resulting from your use of it. You are responsible for independently verifying Lead information and ensuring your outreach is lawful before contacting any Lead.',
      ] },
      { h: '5. Third-Party Integrations', p: [
        'The Service can connect to third-party products (such as HubSpot) that you separately license and control. Your use of those products is governed by their own terms and privacy policies, and we are not responsible for their availability, security, or actions. You authorize us to access and exchange data with a connected product only as needed to provide the features you enable, and you may disconnect an integration at any time.',
      ] },
      { h: '6. Fees', p: [
        'Certain features are provided on a paid subscription or usage basis. Applicable fees, billing frequency, and any usage-based charges are described at the point of purchase or in your order. Unless required by law or stated otherwise, fees are non-refundable. We may change our fees on a prospective basis with reasonable notice.',
      ] },
      { h: '7. Intellectual Property', p: [
        'The Service, including its software, design, and content (excluding your data and Leads), is owned by TechxServe and its licensors and is protected by intellectual-property laws. We grant you a limited, non-exclusive, non-transferable right to use the Service during your subscription. You may not copy, modify, resell, reverse-engineer, or create derivative works from the Service except as permitted by law.',
      ] },
      { h: '8. Termination', p: [
        'You may stop using the Service at any time. We may suspend or terminate your access if you violate these Terms, create risk or legal exposure for us, or for prolonged inactivity or non-payment. Upon termination, your right to use the Service ends; sections that by their nature should survive (including ownership, disclaimers, limitations of liability, and indemnification) will survive.',
      ] },
      { h: '9. Disclaimers', p: [
        'THE SERVICE AND ALL LEAD DATA ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE.',
      ] },
      { h: '10. Limitation of Liability', p: [
        'TO THE MAXIMUM EXTENT PERMITTED BY LAW, TECHXSERVE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUES, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE SERVICE WILL NOT EXCEED THE AMOUNTS YOU PAID TO US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM.',
      ] },
      { h: '11. Indemnification', p: [
        'You will defend, indemnify, and hold harmless TechxServe from and against claims, damages, and expenses (including reasonable legal fees) arising out of your use of the Service, your outreach or communications, or your breach of these Terms or applicable law.',
      ] },
      { h: '12. Changes to These Terms', p: [
        'We may update these Terms from time to time. If we make material changes, we will provide notice through the Service or by other reasonable means. Your continued use after the changes take effect constitutes acceptance of the updated Terms.',
      ] },
      { h: '13. Governing Law', p: [
        'These Terms are governed by the laws of the United States and the state in which TechxServe maintains its principal place of business, without regard to conflict-of-laws rules. The courts located in that jurisdiction will have exclusive jurisdiction over disputes, except where prohibited by applicable law.',
      ] },
      { h: '14. Contact', p: [
        'Questions about these Terms can be sent to support@techxserve.com.',
      ] },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updated: UPDATED,
    sections: [
      { p: [
        'This Privacy Policy explains how LeadIntel, operated by TechxServe ("LeadIntel", "we", "us", or "our"), collects, uses, shares, and protects information in connection with our lead-generation and sales-workflow platform (the "Service"). By using the Service, you agree to the practices described here.',
      ] },
      { h: '1. Information We Collect', p: [
        'Account information: name, email address, role, organization, and authentication details you provide when you sign up or that your administrator provides.',
        'Business contact data (Leads): business names, addresses, phone numbers, websites, ratings, and business email addresses that we compile from publicly available and licensed sources to deliver enrichment and lead intelligence. This is business-directory-type information, not consumer profiles.',
        'Usage and device data: log data, actions taken in the Service, IP address, browser and device information, used to operate, secure, and improve the Service.',
        'Integration data: when you connect a third-party product (such as HubSpot), the access credentials (tokens) needed to sync data, and the specific records you choose to send to or receive from that product.',
      ] },
      { h: '2. HubSpot and CRM Integrations', p: [
        'If you connect HubSpot, you authorize LeadIntel to access your HubSpot account through OAuth solely to provide the integration you enabled. We request only contact scopes (create and read contacts). We use this access to create or update contacts in your HubSpot account from the Leads you send, and to prevent duplicate records.',
        'We do not read, export, harvest, sell, or use your existing HubSpot contacts or other HubSpot data for any purpose beyond delivering the sync you requested. Your HubSpot access tokens are stored encrypted, are accessible only to the backend service that performs the sync, and are never exposed to other customers or to your browser.',
        'You can disconnect HubSpot at any time from Settings → CRM in LeadIntel, or by removing LeadIntel from Connected Apps within HubSpot. Disconnecting revokes our access and stops any further syncing.',
      ] },
      { h: '3. How We Use Information', p: [
        'We use information to provide, maintain, secure, and improve the Service; to compile and deliver lead intelligence; to perform the integrations you enable; to communicate with you about your account and support; to process payments; and to comply with legal obligations. We do not sell your account data or your run inputs to other customers.',
      ] },
      { h: '4. How We Share Information', p: [
        'Service providers (subprocessors): we use trusted vendors to host and operate the Service (for example, cloud infrastructure, database, and email-delivery providers). They process data only on our instructions and under confidentiality obligations.',
        'Connected products: we share data with third-party products you connect, at your direction, to perform the sync.',
        'Legal and safety: we may disclose information where required by law or to protect the rights, property, or safety of our users, the public, or us.',
        'Business transfers: information may be transferred as part of a merger, acquisition, or sale of assets, subject to this Policy.',
      ] },
      { h: '5. Data Retention', p: [
        'We retain account and platform data for as long as your account is active and as needed to provide the Service, then for a limited period to comply with legal, accounting, or reporting obligations. We honor deletion requests as described below, subject to a reasonable retention window and legal requirements.',
      ] },
      { h: '6. Data Security', p: [
        'We use administrative, technical, and organizational safeguards designed to protect information, including encryption in transit, access controls, and restricted handling of integration credentials. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.',
      ] },
      { h: '7. Your Rights', p: [
        'Depending on your location, you may have rights to access, correct, delete, or port your personal data, to object to or restrict certain processing, and to opt out of certain uses. To exercise these rights, contact privacy@techxserve.com. Business contacts included in Lead data may also request removal from our sourced data. We will respond consistent with applicable law (including GDPR and CCPA/CPRA).',
      ] },
      { h: '8. International Transfers', p: [
        'We operate in the United States and may process information in the United States and other countries. Where required, we use appropriate safeguards for cross-border transfers of personal data.',
      ] },
      { h: '9. Cookies', p: [
        'We use cookies and similar technologies to keep you signed in, remember preferences, and understand usage. You can control cookies through your browser settings; disabling some cookies may affect functionality.',
      ] },
      { h: '10. Children', p: [
        'The Service is intended for business use and is not directed to children under 16. We do not knowingly collect personal information from children.',
      ] },
      { h: '11. Changes to This Policy', p: [
        'We may update this Policy from time to time. If we make material changes, we will provide notice through the Service or by other reasonable means, and update the "Last updated" date above.',
      ] },
      { h: '12. Contact', p: [
        'For privacy questions or requests, contact privacy@techxserve.com.',
      ] },
    ],
  },
  aup: {
    title: 'Acceptable Use Policy',
    updated: UPDATED,
    sections: [
      { p: [
        'This Acceptable Use Policy ("AUP") applies to everyone who uses LeadIntel and is incorporated into our Terms of Service. It exists to keep the Service safe, lawful, and reliable for all users.',
      ] },
      { h: '1. Prohibited Uses', p: [
        'You may not use the Service or any Lead data to: (a) send unlawful, harassing, deceptive, or fraudulent communications; (b) violate telemarketing, anti-spam, or data-protection laws; (c) contact people who have opted out or are on applicable do-not-contact lists; (d) infringe others’ rights; (e) attempt to breach security, probe, or disrupt the Service or its infrastructure; or (f) resell or redistribute Lead data except as expressly permitted.',
      ] },
      { h: '2. Outreach Compliance', p: [
        'You are responsible for ensuring every message or call you send is compliant. This includes obtaining any required consent, providing required identification and opt-out mechanisms, honoring opt-out requests promptly, and respecting frequency and time-of-day rules where they apply.',
      ] },
      { h: '3. Enforcement', p: [
        'We may investigate suspected violations and may suspend or terminate access, remove content, or take other action we consider appropriate. Serious or repeated violations may be reported to the relevant authorities.',
      ] },
      { h: '4. Reporting', p: [
        'To report misuse or abuse, contact support@techxserve.com.',
      ] },
    ],
  },
}

export function LegalPage({ doc }: { doc: 'terms' | 'privacy' | 'aup' }) {
  const [params] = useSearchParams()
  const isGate = params.get('gate') === '1' && doc === 'terms'
  const navigate = useNavigate()
  const acceptTos = useAuthStore((s) => s.acceptTos)
  const accept = useMutation({
    mutationFn: authApi.acceptTos,
    onSuccess: (res) => {
      acceptTos(res.tos_accepted_at)
      toast.success('Terms accepted')
      navigate('/home', { replace: true })
    },
  })
  const copy = COPY[doc]

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Card className="p-8">
        <h1 className="text-[24px] font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">Last updated {copy.updated}</p>

        <div className="mt-6 space-y-5">
          {copy.sections.map((s, i) => (
            <section key={i}>
              {s.h && <h2 className="mb-1 text-[16px] font-semibold">{s.h}</h2>}
              {s.p.map((para, j) => (
                <p key={j} className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)] first:mt-0">{para}</p>
              ))}
            </section>
          ))}
        </div>

        {isGate ? (
          <div className="mt-8 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <p className="text-sm font-medium">You must accept the Terms of Service to continue.</p>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              By continuing you also agree to the{' '}
              <Link to="/aup" className="text-[var(--color-primary)] hover:underline">Acceptable Use Policy</Link>.
            </p>
            <Button className="mt-4" loading={accept.isPending} onClick={() => accept.mutate()}>
              Accept &amp; continue
            </Button>
          </div>
        ) : (
          <Link to="/home" className="mt-8 inline-block">
            <Button variant="outline">Back</Button>
          </Link>
        )}
      </Card>
    </div>
  )
}
