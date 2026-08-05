/**
 * SuperOps GraphQL queries.
 *
 * Field/argument names are pinned to what this tenant's schema actually accepts
 * (verified via the GraphQL validation errors surfaced in the debug logs), which
 * differs from the public docs in places:
 *  - association fields (`client`, `accountManager`, `technician`, `ticket`) are
 *    JSON scalars, so they are selected WITHOUT a sub-selection; the defensive
 *    parser reads ids/names out of the JSON value.
 *  - list wrappers vary (`clientContracts`, `entries`, `sites`, `userList`).
 *  - sites/contacts/worklogs take entity-specific `Get*Input!` types.
 * If a tenant differs, the real GraphQL error surfaces (we never fake success)
 * and the parser still maps whatever fields come back.
 */

/** Minimal probe for Test Connection — proves auth/connectivity only. */
export const CLIENT_PROBE_QUERY = `
query getClientList($input: ListInfoInput!) {
  getClientList(input: $input) {
    clients { accountId }
    listInfo { totalCount }
  }
}`;

export const CLIENT_LIST_QUERY = `
query getClientList($input: ListInfoInput!) {
  getClientList(input: $input) {
    clients {
      accountId
      name
      stage
      status
      emailDomains
      accountManager
    }
    listInfo { totalCount }
  }
}`;

export const SITE_LIST_QUERY = `
query getClientSiteList($input: GetClientSiteListInput!) {
  getClientSiteList(input: $input) {
    sites {
      id
      name
      timezone
      client
    }
    listInfo { totalCount }
  }
}`;

export const CONTACT_LIST_QUERY = `
query getClientUserList($input: GetClientUserListInput!) {
  getClientUserList(input: $input) {
    userList {
      userId
      name
      email
      contactNumber
      role
      client
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
      client
    }
    listInfo { totalCount }
  }
}`;

export const CONTRACT_LIST_QUERY = `
query getClientContractList($input: ListInfoInput!) {
  getClientContractList(input: $input) {
    clientContracts {
      contractId
      contract
      contractStatus
      startDate
      endDate
      client
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
      technician
      client
      createdTime
      updatedTime
    }
    listInfo { totalCount }
  }
}`;

export const WORKLOG_LIST_QUERY = `
query getWorklogEntries($input: GetWorklogEntriesInput!) {
  getWorklogEntries(input: $input) {
    entries {
      id
      technician
      timespent
      billable
      notes
      createdTime
      ticket
      client
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
      client
      totalAmount
      items { itemName quantity unitPrice amount }
    }
    listInfo { totalCount }
  }
}`;
