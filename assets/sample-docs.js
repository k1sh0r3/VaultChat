/* VaultChat — bundled sample documents (all fictional, written for this demo).
   Classic script → globalThis.VaultChat.SampleDocs */
(function (root) {
  'use strict';

  var HANDBOOK = [
    'Meridian Labs — Employee Handbook (fictional sample document)',
    '',
    'Section 3: Time Off',
    'Full-time employees accrue paid time off at a rate of 1.5 days per month, up to a maximum balance of 24 days. Unused PTO rolls over each January, but balances above the cap stop accruing until used.',
    'PTO requests for more than five consecutive days need manager approval at least two weeks in advance. Requests under five days need three business days notice.',
    '',
    'Section 7: Remote Work',
    'Employees may work remotely up to three days per week. Core collaboration hours are 10am–3pm Eastern, during which everyone must be reachable.',
    'All remote work requires a secure VPN connection. Public Wi-Fi is prohibited for company systems; use a phone hotspot with WPA3 instead.',
    '',
    'Section 9: Security',
    'Laptops must use full-disk encryption and lock automatically after five minutes idle. Never plug unknown USB devices into company hardware.',
    'Report suspected phishing to security@meridianlabs.example within one hour. Do not forward the suspicious message to colleagues.'
  ].join('\n\n');

  var MEMO = [
    'Field Memo: Urban Pollinator Survey — June 2026 (fictional sample document)',
    '',
    'Summary',
    'Volunteers counted 214 bees across 12 park sites over four weekends in May and June. Counts were highest between 10am and noon on sunny days.',
    '',
    'Findings',
    'Clover patches attracted the most bees (96 visits), followed by lavender beds (61 visits) and wildflower strips (57 visits). Mown-grass control plots drew almost none.',
    'Two bumblebee species dominated the counts: the common eastern bumblebee (58%) and the brown-belted bumblebee (31%).',
    '',
    'Recommendation',
    'Plant clover in the north meadow next spring and reduce mowing there to twice per season. Estimated seed cost is $340 for the half-acre plot.'
  ].join('\n\n');

  var LETTER = [
    "Founder's Letter — Q3 2026 (fictional sample document)",
    '',
    'Team,',
    'Q3 was our strongest quarter yet: revenue grew 34% to $2.1M ARR, and churn fell to 3.1% — our lowest ever. Two forces drove it: the new onboarding flow cut time-to-value from nine days to three, and support response times dropped under two hours.',
    'For Q4 we are betting on two things. First, the analytics add-on launching in November, which 40% of beta customers already pay for. Second, partnerships: the Northwind integration goes live in October and should open roughly 200 mid-market accounts.',
    'Hiring plan: six engineers and two designers before year end. No new office — we stay remote-first, and the offsite moves to March.',
    'Thank you for the quarter. The plan only works if we keep shipping.',
    '— A. Reyes, Founder'
  ].join('\n\n');

  root.VaultChat = root.VaultChat || {};
  root.VaultChat.SampleDocs = [
    { name: 'Employee Handbook (sample)', text: HANDBOOK },
    { name: 'Pollinator Survey Memo (sample)', text: MEMO },
    { name: "Founder's Letter Q3 (sample)", text: LETTER }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
