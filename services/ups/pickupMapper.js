function onlyDigits(s) {
    return String(s || '').replace(/\D+/g, '');
}

function toYMD(value) {
    if (!value) return '';
    const s = String(value).trim();

    if (/^\d{8}$/.test(s)) return s;

    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;

    return s.replace(/\D/g, '');
}

function toHM(value) {
    if (!value) return '';
    const s = String(value).trim();

    if (/^\d{4}$/.test(s)) return s;

    const m = s.match(/^(\d{2}):(\d{2})$/);
    if (m) return `${m[1]}${m[2]}`;

    return s.replace(/\D/g, '').slice(0, 4);
}

function buildUpsPickupPayload(data) {
    const accountNumber = data.accountNumber;
    if (!accountNumber) {
        throw new Error('Conta UPS não informada para pickup.');
    }

    const countryCode = String(data.countryCode || 'BR').toUpperCase();
    const destinationCountryCode = String(
        data.destinationCountryCode || countryCode
    ).toUpperCase();

    return {
        PickupCreationRequest: {
            RatePickupIndicator: data.ratePickupIndicator || 'N',
            Shipper: {
                Account: {
                    AccountNumber: accountNumber,
                    AccountCountryCode: countryCode,
                },
            },
            PickupDateInfo: {
                CloseTime: toHM(data.closeTime),
                PickupDate: toYMD(data.pickupDate),
                ReadyTime: toHM(data.readyTime),
            },
            PickupAddress: {
                CompanyName: data.companyName || data.contactName || 'Intrex',
                ContactName: data.contactName,
                AddressLine: String(data.addressLine1 || ''),
                Room: data.room || '',
                Floor: data.floor || '',
                City: data.city,
                StateProvince: data.stateCode,
                Urbanization: data.neighborhood || '',
                PostalCode: onlyDigits(data.postalCode),
                CountryCode: countryCode,
                ResidentialIndicator: String(data.residentialIndicator || 'N'),
                PickupPoint: data.pickupPoint || '',
                Phone: {
                    Number: onlyDigits(data.phone),
                    Extension: data.phoneExtension || '',
                },
            },
            AlternateAddressIndicator: data.alternateAddressIndicator || 'Y',
            PickupPiece: [
    {
        ServiceCode: '001',
        Quantity: String(data.packageCount || 1),
        DestinationCountryCode: 'US',
        ContainerCode: data.containerCode || '01',
    },
],
            TotalWeight: {
                Weight: String(data.totalWeight || 1),
                UnitOfMeasurement: data.weightUnit || 'KGS',
            },
            OverweightIndicator: data.overweightIndicator || 'N',
            PaymentMethod: data.paymentMethod || '01',
            SpecialInstruction: data.specialInstructions || '',
            ReferenceNumber: data.referenceNumber || '',
        },
    };
}

module.exports = {
    buildUpsPickupPayload,
};