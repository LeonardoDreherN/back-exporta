function buildUpsPickupPayload(data) {
  return {
    accountNumber: data.accountNumber,

    requester: {
      name: data.contactName,
      phone: data.phone,
    },

    pickupAddress: {
      countryCode: data.countryCode,
      stateProvince: data.stateCode,
      city: data.city,
      postalCode: data.postalCode,
      addressLine: data.addressLine1,
    },

    pickupDate: data.pickupDate,
    readyTime: data.readyTime,
    closeTime: data.closeTime,

    totalWeight: Number(data.totalWeight),
    weightUnit: data.weightUnit || 'KGS',
    packageCount: Number(data.packageCount),

    specialInstructions: data.specialInstructions || '',
  };
}

module.exports = {
  buildUpsPickupPayload,
};