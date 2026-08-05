/**
 * SuperOps GraphQL queries.
 *
 * Field/argument names follow the documented MSP schema. If a tenant's schema
 * differs, the real GraphQL error surfaces (we never fake success) and the
 * defensive parser in parse.ts still maps whatever fields are returned. The
 * invoice query stays overridable via the connector's "Invoices GraphQL query".
 */

export const CLIENT_LIST_QUERY = `
query getClientList($input: ListInfoInput!) {
  getClientList(input: $input) {
    clients {
      accountId
      name
      stage
      status
      emailDomains
      accountManager { name email }
    }
    listInfo { totalCount }
  }
}`;

export const SITE_LIST_QUERY = `
query getClientSiteList($input: ListInfoInput!) {
  getClientSiteList(input: $input) {
    clientSites {
      id
      name
      timezone
      client { accountId }
      address { line1 line2 city state countryCode postalCode }
    }
    listInfo { totalCount }
  }
}`;

export const CONTACT_LIST_QUERY = `
query getClientUserList($input: ListInfoInput!) {
  getClientUserList(input: $input) {
    userList {
      userId
      name
      email
      contactNumber
      role
      client { accountId }
    }
    listInfo { totalCount }
  }
}`;

export const ASSET_LIST_QUERY = `
query getAssetList($input: ListInfoInput!) {
  getAssetList(input: $input) {
    assets {
      assetId
      name
      serialNumber
      platform
      status
      lastCommunicatedTime
      client { accountId }
    }
    listInfo { totalCount }
  }
}`;

export const CONTRACT_LIST_QUERY = `
query getClientContractList($input: ListInfoInput!) {
  getClientContractList(input: $input) {
    contracts {
      contractId
      name
      contractStatus
      startDate
      endDate
      client { accountId }
    }
    listInfo { totalCount }
  }
}`;

export const TICKET_LIST_QUERY = `
query getTicketList($input: ListInfoInput!) {
  getTicketList(input: $input) {
    tickets {
      ticketId
      displayId
      subject
      status
      priority
      technician { name email }
      client { accountId name }
      createdTime
      updatedTime
    }
    listInfo { totalCount }
  }
}`;

export const WORKLOG_LIST_QUERY = `
query getWorklogEntries($input: ListInfoInput!) {
  getWorklogEntries(input: $input) {
    worklogEntries {
      worklogId
      technician { name email }
      timeSpent
      billable
      notes
      entryTime
      ticket { ticketId }
      client { accountId }
    }
    listInfo { totalCount }
  }
}`;

export const INVOICE_LIST_QUERY = `
query getInvoiceList($input: ListInfoInput!) {
  getInvoiceList(input: $input) {
    invoices {
      invoiceId
      displayId
      statusEnum
      invoiceDate
      dueDate
      client { accountId name }
      subTotalAmount
      taxAmount
      totalAmount
      items { itemName quantity unitPrice amount }
    }
    listInfo { totalCount }
  }
}`;
