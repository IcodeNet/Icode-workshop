def approved_only(documents):
    return [document for document in documents if document.get('status') == 'approved']
