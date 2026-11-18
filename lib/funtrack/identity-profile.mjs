export function activeProfile(profile, subject) {
  return !!profile && profile.id === subject && !profile.banned && !profile.locked && !profile.deprovisioned;
}
export function verifiedAddress(profile) {
  const addresses = (Array.isArray(profile?.emailAddresses) ? profile.emailAddresses : []).filter(item =>
    item?.verification?.status === 'verified' && typeof item.emailAddress === 'string' &&
    /^[^\s@]+@[^\s@]+$/.test(item.emailAddress) && item.emailAddress.length <= 320 && !/[^\x20-\x7e]/.test(item.emailAddress));
  return addresses.find(item => item.id === profile.primaryEmailAddressId) ?? addresses[0];
}
export function profileName(profile) {
  return ([profile.firstName, profile.lastName].filter(part => typeof part === 'string' && part.trim()).join(' ').trim() ||
    (typeof profile.username === 'string' ? profile.username.trim() : '') || verifiedAddress(profile)?.emailAddress.split('@')[0] || '创作者').slice(0, 80);
}
