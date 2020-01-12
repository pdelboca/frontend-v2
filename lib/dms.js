'use strict'

const { resolve, URL } = require('url')
const fetch = require('node-fetch')
const utils = require('../utils')

class DmsModel {
  constructor(config) {
    this.config = config
    this.api = config.get('API_URL')
  }

  async getBlobLFSDownloadURL(lfsServer, oid, size){
    // Construct a call to the Git LFS Batch API
    // https://github.com/git-lfs/git-lfs/blob/master/docs/api/batch.md
    const body = {
        operation: 'download',
        transfers: ['basic'],
        ref: {name: 'refs/heads/master'},
        objects: [
          {
            oid: oid,
            size: size
          }
        ]
      }
    let response = await fetch(lfsServer, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Accept': 'application/vnd.git-lfs+json',
            'Content-Type': 'application/vnd.git-lfs+json'
        }
      })
      .then(res => res.json())

      // TODO: better way to obtain the href
    const lfsDownloadURL = response.objects[0].actions.download.href
    return lfsDownloadURL
  }

  async getBlobURL(owner, name, ref, path){
    const rawURL = 'https://raw.githubusercontent.com/'+owner+'/'+name+'/'+ref+'/'+path

    //TODO: don't read all the body, only firsts bytes
    let response = await fetch(rawURL)
      .then(res => res.text())

    if (response.substring(0, 30).includes('git-lfs')){
        const lfsServer = 'https://github.com/'+owner+'/'+name+'.git/info/lfs/objects/batch'
        const oid = response.match('[A-Fa-f0-9]{64}')[0]
        const size = parseInt(response.match('[^size ]*$')[0])

        const blobURL = await this.getBlobLFSDownloadURL(lfsServer, oid, size)
        return blobURL
    }
    // rawURL are blob urls for files that are not stored in git lfs
    return rawURL
  }

  async search(query, context) {
    // TODO: context can have API Key so we need to pass it through
    const action = 'package_search'
    let url = new URL(resolve(this.api, action))
    const params = utils.convertToCkanSearchQuery(query)
    let response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' }
    })

    response = await response.json()
    // Convert CKAN descriptor => data package
    response.result.results = response.result.results.map(pkg => {
      return utils.ckanToDataPackage(pkg)
    })
    return response.result
  }

  async getPackage(owner, name) {
    let path = 'repos/'+ owner + '/' + name + '/contents/datapackage.json'
    let url = new URL(resolve(this.api, path))

    let response = await fetch(url, {
      method: 'GET'
    })
    if (response.status !== 200) {
      throw response
    }
    response = await response.json()

    // TODO: base64 decode the content of response or use raw from the beggining
    let datapackage = await fetch(response.download_url, {
        method: 'GET'
    })
    if (datapackage.status !== 200) {
      throw datapackage
    }
    datapackage = await datapackage.json()

    return datapackage
  }

  async getResourceViews(resourceId) {
    try{
      const action = 'resource_view_list'
      let url = new URL(resolve(this.api, action))
      url.search = `id=${resourceId}`

      let response = await fetch(url, {
        method: 'GET'
      })
      if (response.status !== 200) {
        throw response
      }
      response = await response.json()
      const views = response.result
      for (let i = 0; i < views.length; i++) {
        views[i] = utils.ckanViewToDataPackageView(views[i])
      }
      return views
    } catch (e) {
      console.warn('Error fetching resource views', e)
      return []
    }
  }

  async getOrganizations() {
    const action = 'organization_list'
    let url = new URL(resolve(this.api, action))
    const params = {
      all_fields: true,
      sort: 'package_count'
    }
    let response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' }
    })
    if (response.status !== 200) {
      throw response
    }
    response = await response.json()
    // Convert CKAN group descriptor into "standard" collection descriptor
    const organizations = response.result.map(org => {
      return utils.convertToStandardCollection(org)
    })
    return organizations
  }

  async getProfile(owner) {
    try {
      const action = 'organization_show'
      let url = new URL(resolve(this.api, action))
      url.search = `id=${owner}&include_users=false`
      let response = await fetch(url, {
        method: 'GET',
      })
      if (response.status !== 200) {
        throw response
      }
      response = await response.json()
      return response.result
    } catch (e) {
      console.warn('Failed to fetch profile', e)
      return {}
    }
  }

  async getCollections(params) {
    const action = 'group_list'
    let url = new URL(resolve(this.api, action))
    params = params ? params : {
      all_fields: true
    }
    let response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' }
    })
    if (response.status !== 200) {
      throw response
    }
    response = await response.json()
    // Convert CKAN group descriptor into "standard" collection descriptor
    const collections = response.result.map(collection => {
      return utils.convertToStandardCollection(collection)
    })
    return collections
  }

  async getCollection(collection) {
    const action = 'group_show'
    let url = new URL(resolve(this.api, action))
    const params = {
      id: collection
    }
    let response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' }
    })
    if (response.status !== 200) {
      throw response
    }
    response = await response.json()
    return utils.convertToStandardCollection(response.result)
  }
}

module.exports.DmsModel = DmsModel
