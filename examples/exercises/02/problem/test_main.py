from main import approved_only

def test_approved_only():
    assert approved_only([{'id': 1, 'status': 'approved'}, {'id': 2, 'status': 'draft'}]) == [{'id': 1, 'status': 'approved'}]
